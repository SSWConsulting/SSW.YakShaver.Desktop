import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const YT_DLP_MACOS_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
const YT_DLP_PATH = path.join("node_modules", "youtube-dl-exec", "bin", "yt-dlp");
const MAX_REDIRECTS = 5;

function shouldSkipInstall() {
  return process.env.YOUTUBE_DL_SKIP_DOWNLOAD === "true";
}

function downloadFile(url, outputPath, redirectsRemaining = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "YakShaver yt-dlp installer",
        },
      },
      async (response) => {
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
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to download yt-dlp. HTTP status: ${statusCode}`));
          return;
        }

        try {
          await pipeline(response, createWriteStream(outputPath, { mode: 0o755 }));
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );

    request.on("error", reject);
  });
}

async function verifyYtDlp(binaryPath) {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 10_000 });
    const version = stdout.trim();
    if (!version) {
      throw new Error("yt-dlp did not print a version");
    }

    console.log(`[yt-dlp] Installed standalone macOS binary version ${version}`);
  } catch (error) {
    throw new Error(
      `Installed yt-dlp binary failed verification: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function installYtDlpForMacOS() {
  if (shouldSkipInstall()) {
    console.log("[yt-dlp] Skipping install because YOUTUBE_DL_SKIP_DOWNLOAD=true");
    return;
  }

  if (process.platform !== "darwin") {
    console.log(`[yt-dlp] Skipping standalone macOS binary install on ${process.platform}`);
    return;
  }

  const outputPath = path.resolve(YT_DLP_PATH);
  const temporaryPath = `${outputPath}.download`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  console.log(`[yt-dlp] Downloading standalone macOS binary to ${outputPath}`);
  await downloadFile(YT_DLP_MACOS_URL, temporaryPath);
  await chmod(temporaryPath, 0o755);
  await rename(temporaryPath, outputPath);
  await verifyYtDlp(outputPath);
}

installYtDlpForMacOS().catch((error) => {
  console.error(`[yt-dlp] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
