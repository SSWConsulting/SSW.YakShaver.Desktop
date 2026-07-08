import path from "node:path";
import { app } from "electron";
import tmp from "tmp";
import type { VideoUploadResult } from "../auth/types";
import { defaultProcessSpawner, type IProcessSpawner } from "../process/process-spawner";

const YT_DLP_EXECUTABLE = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

function getYtDlpPath(): string {
  if (app.isPackaged) {
    // In production, the binary is unpacked to app.asar.unpacked
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "youtube-dl-exec",
      "bin",
      YT_DLP_EXECUTABLE,
    );
  }

  return path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", YT_DLP_EXECUTABLE);
}

function formatYtDlpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ENOENT") || message.includes("no such file or directory")) {
    if (app.isPackaged) {
      return `${message}. The bundled yt-dlp binary appears to be missing. Please reinstall or repair the app, and contact support if the problem persists.`;
    }

    return `${message}. Run npm run install:yt-dlp to install the standalone yt-dlp binary.`;
  }

  return message;
}

/**
 * Renders a yt-dlp invocation as a human-readable string for logging purposes only — it is
 * never used to actually run the command. The real invocation always spawns with an argument
 * *array* (see `runYtDlp`), so this string can never reintroduce the quoting/escaping bug it
 * is describing; it only wraps values containing whitespace in quotes so the logged line reads
 * the way a shell command would.
 */
function describeInvocationForLogging(binaryPath: string, args: string[]): string {
  const quoteIfNeeded = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
  return [quoteIfNeeded(binaryPath), ...args.map(quoteIfNeeded)].join(" ");
}

interface YtDlpRunResult {
  stdout: string;
  stderr: string;
}

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;

  constructor(
    private readonly binaryPath: string = getYtDlpPath(),
    private readonly processSpawner: IProcessSpawner = defaultProcessSpawner,
  ) {}

  public static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  /**
   * Spawns yt-dlp with an explicit argument *array* — never a concatenated command-line string
   * — so that paths containing spaces (e.g. Windows profile paths like
   * `C:\Users\First Last\...`) survive intact all the way to the child process. Node's
   * `child_process.spawn(command, args[])` (via `IProcessSpawner`, the same seam
   * `FFmpegService` uses) hands each argument to the OS process-creation API as a discrete
   * token; nothing here builds a single string that a shell — or a naive `string.split(" ")`
   * like the one inside the `tinyspawn` dependency `youtube-dl-exec` used to pull in — could
   * re-split on whitespace and corrupt.
   */
  private runYtDlp(args: string[]): Promise<YtDlpRunResult> {
    // Log the resolved binary path and the exact arguments before spawning (acceptance
    // criterion: visibility into the resolved download path + command). Neither the binary
    // path nor these yt-dlp flags/URLs/paths carry secrets on this code path (no auth tokens or
    // cookies are ever passed to yt-dlp here), so nothing needs to be redacted.
    console.log(
      `[YouTubeDownloadService] Resolved yt-dlp binary: ${this.binaryPath}`,
      `\n[YouTubeDownloadService] Running: ${describeInvocationForLogging(this.binaryPath, args)}`,
    );

    return new Promise((resolve, reject) => {
      let child: ReturnType<IProcessSpawner["spawn"]>;
      try {
        child = this.processSpawner.spawn(this.binaryPath, args);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error: Error) => {
        reject(error);
      });

      child.on("close", (code: number | null) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code ?? "unknown"}`));
      });
    });
  }

  public async getVideoMetadata(youtubeUrl: string): Promise<VideoUploadResult> {
    const args = ["--skip-download", "--dump-single-json", "--no-warnings", "--quiet", youtubeUrl];

    try {
      const { stdout } = await this.runYtDlp(args);
      const metadata = JSON.parse(stdout);

      if (metadata && typeof metadata === "object" && "id" in metadata) {
        return {
          success: true,
          data: {
            videoId: metadata.id,
            title: metadata.title,
            description: metadata.description,
            url: metadata.webpage_url,
            duration: metadata.duration,
          },
          origin: "external",
        };
      }

      return {
        success: false,
        error: `Failed to retrieve video metadata: ${stdout}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch video metadata: ${formatYtDlpError(error)}`,
      };
    }
  }

  public async downloadVideoToFile(youtubeUrl: string, outputPath?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    outputPath ??= tmp.tmpNameSync({ postfix: ".mp4" });
    console.log("[YouTubeDownloadService] Downloading video to:", outputPath);

    const args = [
      "--output",
      outputPath,
      "--format",
      "mp4",
      "--restrict-filenames",
      "--no-warnings",
      "--quiet",
      youtubeUrl,
    ];

    try {
      await this.runYtDlp(args);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to download video: ${formatYtDlpError(error)}`);
    }
  }
}
