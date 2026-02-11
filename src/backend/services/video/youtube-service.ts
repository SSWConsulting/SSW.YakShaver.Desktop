import { spawn } from "node:child_process";
import tmp from "tmp";
import type { VideoUploadResult } from "../auth/types";
import { resolveYtDlpBinaryPath } from "./yt-dlp-binary";
import { resolveDownloadedFilePath } from "./yt-dlp-output";

export function buildYtDlpUserAgentArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const userAgent = env.YAKSHAVER_YTDLP_USER_AGENT?.trim();
  return userAgent ? ["--user-agent", userAgent] : [];
}

export function buildYtDlpCookieArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const cookiesFile = env.YAKSHAVER_YTDLP_COOKIES_FILE?.trim();
  const cookiesFromBrowser = env.YAKSHAVER_YTDLP_COOKIES_FROM_BROWSER?.trim();

  if (cookiesFile) return ["--cookies", cookiesFile];
  if (cookiesFromBrowser) return ["--cookies-from-browser", cookiesFromBrowser];
  return [];
}

export function buildYtDlpAuthArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...buildYtDlpCookieArgs(env), ...buildYtDlpUserAgentArgs(env)];
}

type YtDlpRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

async function runYtDlp(binaryPath: string, args: string[]): Promise<YtDlpRunResult> {
  return await new Promise<YtDlpRunResult>((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode, signal });
        return;
      }

      const error = Object.assign(new Error(stderr.trim() || stdout.trim() || "yt-dlp failed"), {
        stdout,
        stderr,
        exitCode,
        signal,
        path: binaryPath,
      });
      reject(error);
    });
  });
}

async function assertYtDlpExecutable(binaryPath: string): Promise<void> {
  await runYtDlp(binaryPath, ["--version"]);
}

function isYouTubeBotCheckError(error: unknown): boolean {
  const message = formatYtDlpExecError(error);
  return /sign in to confirm you.?re not a bot/i.test(message);
}

function defaultCookiesFromBrowserCandidates(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["chrome", "brave", "edge", "chromium", "firefox"];
    case "win32":
      return ["chrome", "edge", "brave", "firefox"];
    default:
      return ["chrome", "chromium", "brave", "firefox"];
  }
}

async function runYtDlpWithCookieFallback(
  binaryPath: string,
  argsPrefix: string[],
  url: string,
): Promise<YtDlpRunResult> {
  const cookieArgs = buildYtDlpCookieArgs();
  const userAgentArgs = buildYtDlpUserAgentArgs();

  try {
    return await runYtDlp(binaryPath, [...argsPrefix, ...cookieArgs, ...userAgentArgs, url]);
  } catch (error) {
    if (cookieArgs.length) throw error;
    if (!isYouTubeBotCheckError(error)) throw error;

    const candidates = defaultCookiesFromBrowserCandidates();
    const candidateErrors: string[] = [];
    let lastError: unknown = error;
    for (const candidate of candidates) {
      try {
        return await runYtDlp(binaryPath, [
          ...argsPrefix,
          "--cookies-from-browser",
          candidate,
          ...userAgentArgs,
          url,
        ]);
      } catch (candidateError) {
        candidateErrors.push(`${candidate}: ${formatYtDlpExecError(candidateError)}`);
        lastError = candidateError;
      }
    }

    if (candidateErrors.length) {
      throw new Error(
        `YouTube requires sign-in (bot-check). Tried cookies-from-browser but failed: ${candidateErrors.join(
          " | ",
        )}`,
      );
    }
    throw lastError;
  }
}

function formatYtDlpExecError(error: unknown): string {
  if (!error) return "Unknown yt-dlp error";

  const err = error as (Error & Record<string, unknown>) | Record<string, unknown>;

  const toText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
    return "";
  };

  const stderr = toText((err as any).stderr).trim();
  const stdout = toText((err as any).stdout).trim();
  const message = (err instanceof Error ? err.message : String(error)).trim();

  let base = stderr || stdout || message;

  const code = (err as any).code;
  const exitCode = (err as any).exitCode;
  const signal = (err as any).signal;
  const syscall = (err as any).syscall;
  const errorPath = (err as any).path;
  const suffixParts = [
    typeof code === "string" ? `code=${code}` : null,
    typeof syscall === "string" ? `syscall=${syscall}` : null,
    typeof errorPath === "string" ? `path=${errorPath}` : null,
    typeof exitCode === "number" ? `exitCode=${exitCode}` : null,
    typeof signal === "string" && signal ? `signal=${signal}` : null,
  ].filter(Boolean);

  if (!base) {
    base = suffixParts.length ? "yt-dlp failed" : "Unknown yt-dlp error";
  }
  if (suffixParts.length) {
    base = `${base} (${suffixParts.join(", ")})`;
  }

  const maxLen = 4000;
  if (base.length > maxLen) {
    return `${base.slice(0, maxLen)}…`;
  }
  return base;
}

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;
  private binaryPath?: string;
  private initPromise?: Promise<void>;

  private constructor() {}

  public static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  private async ensureBinaryPath(): Promise<string> {
    if (this.binaryPath) return this.binaryPath;
    this.initPromise ??= (async () => {
      const resolved = await resolveYtDlpBinaryPath();
      this.binaryPath = resolved.binaryPath;
      await assertYtDlpExecutable(resolved.binaryPath);
      console.log(
        `[YouTubeDownloadService] Using yt-dlp (${resolved.source}): ${resolved.binaryPath}`,
      );
    })();

    await this.initPromise;
    if (!this.binaryPath) {
      throw new Error("youtube-download-service: yt-dlp binary initialization failed");
    }
    return this.binaryPath;
  }

  public async getVideoMetadata(youtubeUrl: string): Promise<VideoUploadResult> {
    const binaryPath = await this.ensureBinaryPath();
    const isDebug = process.env.YAKSHAVER_YTDLP_DEBUG === "1";
    const argsPrefix = [
      "--skip-download",
      "--dump-single-json",
      "--no-progress",
      ...(isDebug ? ["--verbose"] : ["--no-warnings", "--quiet"]),
    ];
    try {
      const { stdout } = await runYtDlpWithCookieFallback(binaryPath, argsPrefix, youtubeUrl);
      const metadata = JSON.parse(stdout) as Record<string, unknown>;
      if (!metadata || typeof metadata !== "object" || !("id" in metadata)) {
        return { success: false, error: "Failed to retrieve video metadata" };
      }

      const videoId =
        typeof metadata.id === "string"
          ? metadata.id
          : metadata.id != null
            ? String(metadata.id)
            : "";
      if (!videoId) {
        return { success: false, error: "Failed to retrieve video metadata" };
      }

      return {
        success: true,
        data: {
          videoId,
          title: typeof metadata.title === "string" ? metadata.title : "",
          description: typeof metadata.description === "string" ? metadata.description : "",
          url: typeof metadata.webpage_url === "string" ? metadata.webpage_url : "",
          duration: typeof metadata.duration === "number" ? metadata.duration : undefined,
        },
        origin: "external",
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch video metadata: ${formatYtDlpExecError(error)}`,
      };
    }
  }

  public async downloadVideoToFile(youtubeUrl: string, outputPath?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    const binaryPath = await this.ensureBinaryPath();
    const isDebug = process.env.YAKSHAVER_YTDLP_DEBUG === "1";
    const basePath = outputPath ?? tmp.tmpNameSync();
    const outputTemplate = outputPath ?? `${basePath}.%(ext)s`;
    console.log("[YouTubeDownloadService] Downloading video to:", outputTemplate);
    const argsPrefix = [
      "--output",
      outputTemplate,
      "--format",
      "bestvideo*+bestaudio/best",
      "--merge-output-format",
      "mp4",
      "--restrict-filenames",
      "--retries",
      "3",
      "--no-progress",
      ...(isDebug ? ["--verbose"] : ["--no-warnings"]),
    ];

    try {
      await runYtDlpWithCookieFallback(binaryPath, argsPrefix, youtubeUrl);
      if (outputPath) return outputPath;
      const resolvedOutput = await resolveDownloadedFilePath(basePath);
      console.log("[YouTubeDownloadService] Downloaded video path:", resolvedOutput);
      return resolvedOutput;
    } catch (error) {
      throw new Error(`Failed to download video: ${formatYtDlpExecError(error)}`);
    }
  }
}
