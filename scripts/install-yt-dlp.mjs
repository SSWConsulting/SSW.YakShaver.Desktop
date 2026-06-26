import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const YT_DLP_RELEASE_BASE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const YT_DLP_BIN_DIR = path.join("node_modules", "youtube-dl-exec", "bin");
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const PLATFORM_CONFIGS = {
  darwin: {
    assetName: "yt-dlp_macos",
    fileName: "yt-dlp",
    shouldChmod: true,
  },
  win32: {
    assetName: "yt-dlp.exe",
    fileName: "yt-dlp.exe",
    shouldChmod: false,
  },
};

function shouldSkipInstall() {
  return process.env.YOUTUBE_DL_SKIP_DOWNLOAD === "true";
}

function getPlatformConfig() {
  if (process.platform === "darwin" || process.platform === "win32") {
    return PLATFORM_CONFIGS[process.platform];
  }

  return null;
}

function downloadFile(url, outputPath, redirectsRemaining = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "YakShaver yt-dlp installer",
        },
      },
      async (response) => {
        response.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
          response.destroy(
            new Error(`Timed out downloading yt-dlp after ${DOWNLOAD_TIMEOUT_MS}ms`),
          );
        });

        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          response.resume();

          if (redirectsRemaining === 0) {
            reject(new Error(`Too many redirects while downloading yt-dlp from ${url}`));
            return;
          }

          const redirectUrl = new URL(location, url).toString();
          try {
            await downloadFile(redirectUrl, outputPath, redirectsRemaining - 1);
            resolveOnce();
          } catch (error) {
            rejectOnce(error);
          }
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          rejectOnce(new Error(`Failed to download yt-dlp. HTTP status: ${statusCode}`));
          return;
        }

        try {
          await pipeline(response, createWriteStream(outputPath, { mode: 0o755 }));
          resolveOnce();
        } catch (error) {
          rejectOnce(error);
        }
      },
    );

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out connecting to ${url} after ${DOWNLOAD_TIMEOUT_MS}ms`));
    });
    request.on("error", rejectOnce);
  });
}

async function verifyYtDlp(binaryPath) {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 10_000 });
    const version = stdout.trim();
    if (!version) {
      throw new Error("yt-dlp did not print a version");
    }

    console.log(`[yt-dlp] Installed standalone binary version ${version}`);
  } catch (error) {
    throw new Error(
      `Installed yt-dlp binary failed verification: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function installYtDlp() {
  if (shouldSkipInstall()) {
    console.log("[yt-dlp] Skipping install because YOUTUBE_DL_SKIP_DOWNLOAD=true");
    return;
  }

  const config = getPlatformConfig();
  if (!config) {
    console.log(`[yt-dlp] Skipping standalone binary install on ${process.platform}`);
    return;
  }

  const downloadUrl = `${YT_DLP_RELEASE_BASE_URL}/${config.assetName}`;
  const outputPath = path.resolve(YT_DLP_BIN_DIR, config.fileName);
  const temporaryPath = `${outputPath}.download`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  console.log(`[yt-dlp] Downloading standalone ${process.platform} binary to ${outputPath}`);
  await downloadFile(downloadUrl, temporaryPath);
  if (config.shouldChmod) {
    await chmod(temporaryPath, 0o755);
  }
  await rename(temporaryPath, outputPath);
  await verifyYtDlp(outputPath);
}

installYtDlp().catch((error) => {
  console.error(`[yt-dlp] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
