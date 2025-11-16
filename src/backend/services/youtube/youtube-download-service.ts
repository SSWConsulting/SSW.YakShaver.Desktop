import fs from "node:fs/promises";
import ytDlp, { create as createYtDlp, type YtFlags } from "yt-dlp-exec";
import tmp from "tmp";
import { formatErrorMessage } from "../../utils/error-utils";

tmp.setGracefulCleanup();

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;
  private downloadClient: typeof ytDlp;

  private constructor() {
    this.downloadClient = ytDlp;
    void this.bootstrapClient();
  }

  static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  private async bootstrapClient() {
    const binaryPath = await this.resolveBinaryPath();
    if (!binaryPath) {
      return;
    }

    try {
      await fs.access(binaryPath);
      this.downloadClient = createYtDlp(binaryPath);
    } catch (error) {
      console.warn(
        "[youtube-download-service] Failed to access yt-dlp binary at",
        binaryPath,
        error,
      );
      this.downloadClient = ytDlp;
    }
  }

  private async resolveBinaryPath(): Promise<string | null> {
    try {
      const constants = require("yt-dlp-exec/src/constants") as { YOUTUBE_DL_PATH?: string };
      const defaultPath = constants.YOUTUBE_DL_PATH;
      if (!defaultPath) {
        return null;
      }

      if (!defaultPath.includes("app.asar")) {
        return defaultPath;
      }

      const unpackedPath = defaultPath.replace("app.asar", "app.asar.unpacked");
      return unpackedPath;
    } catch (error) {
      console.warn("[youtube-download-service] Unable to resolve yt-dlp path", error);
      return null;
    }
  }

  async downloadVideo(youtubeUrl: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    const outputPath = tmp.tmpNameSync({ postfix: ".mp4" });

    try {
      const flags: YtFlags = {
        output: outputPath,
        format: "bestvideo+bestaudio/best",
        mergeOutputFormat: "mp4",
        restrictFilenames: true,
        noWarnings: true,
        quiet: true,
      };

      await this.downloadClient(youtubeUrl, flags);

      return outputPath;
    } catch (error) {
      console.error("[youtube-download-service] download failed", error);
      await this.tryDelete(outputPath);
      const message = formatErrorMessage(error);
      throw new Error(`youtube-download-service: Failed to download video (${message})`);
    }
  }

  private async tryDelete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn("[youtube-download-service] failed to cleanup temp file", error);
    }
  }
}

