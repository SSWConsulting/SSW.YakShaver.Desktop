import path from "node:path";
import { app } from "electron";
import tmp from "tmp";
import youtubedl, { type Flags } from "youtube-dl-exec";
import type { VideoUploadResult } from "../auth/types";

function getYtDlpPath(): string {
  if (app.isPackaged) {
    // In production, the binary is unpacked to app.asar.unpacked
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "youtube-dl-exec",
      "bin",
      process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
    );
  }
  // In development, use the default path
  return require("youtube-dl-exec").constants.YOUTUBE_DL_PATH;
}

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;
  private downloadClient: ReturnType<typeof youtubedl.create>;
  private binaryPath: string;

  private constructor() {
    this.binaryPath = getYtDlpPath();
    this.downloadClient = youtubedl.create(this.binaryPath);
  }

  public static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  public async getVideoMetadata(youtubeUrl: string): Promise<VideoUploadResult> {
    const flags: Flags = {
      skipDownload: true,
      dumpSingleJson: true,
      noWarnings: true,
      quiet: true,
    };
    try {
      const metadata = await this.downloadClient(youtubeUrl, flags);
      if (
        typeof metadata !== "string" &&
        metadata &&
        typeof metadata === "object" &&
        "id" in metadata
      ) {
        return {
          success: true,
          data: {
            videoId: metadata.id,
            title: metadata.title,
            description: metadata.description,
            url: metadata.webpage_url,
          },
          origin: "external",
        };
      } else {
        return {
          success: false,
          error: `Failed to retrieve video metadata: ${metadata}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch video metadata: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  public async downloadVideoToFile(youtubeUrl: string, outputPath?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    outputPath ??= tmp.tmpNameSync({ postfix: ".mp4" });
    console.log("[YouTubeDownloadService] Downloading video to:", outputPath);
    const flags: Flags = {
      output: outputPath,
    };

    try {
      await this.downloadClient(youtubeUrl, flags);
      return outputPath;
    } catch (error) {
      throw new Error(
        `Failed to download video: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
