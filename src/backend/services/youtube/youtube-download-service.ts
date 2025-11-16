import fs from "node:fs/promises";
import ytDlp from "yt-dlp-exec";
import tmp from "tmp";
import { formatErrorMessage } from "../../utils/error-utils";

tmp.setGracefulCleanup();

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;

  private constructor() {}

  static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  async downloadVideo(youtubeUrl: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    const outputPath = tmp.tmpNameSync({ postfix: ".mp4" });

    try {
      await ytDlp(youtubeUrl, {
        output: outputPath,
        format: "bestvideo+bestaudio/best",
        mergeOutputFormat: "mp4",
        restrictFilenames: true,
        noWarnings: true,
        quiet: true,
      });

      return outputPath;
    } catch (error) {
      await this.tryDelete(outputPath);
      const message = formatErrorMessage(error);
      throw new Error(`youtube-download-service: Failed to download video (${message})`);
    }
  }

  private async tryDelete(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }
}

