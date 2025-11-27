import tmp from "tmp";
import ytDlp, { type YtFlags } from "yt-dlp-exec";
import type { VideoUploadResult } from "../auth/types";

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  description: string;
  url: string;
}

export class YouTubeDownloadService {
  private static instance: YouTubeDownloadService;
  private downloadClient: typeof ytDlp;

  private constructor() {
    this.downloadClient = ytDlp;
  }

  public static getInstance(): YouTubeDownloadService {
    if (!YouTubeDownloadService.instance) {
      YouTubeDownloadService.instance = new YouTubeDownloadService();
    }
    return YouTubeDownloadService.instance;
  }

  public async getVideoMetadata(youtubeUrl: string): Promise<VideoUploadResult> {
    const flags: YtFlags = {
      skipDownload: true,
      dumpSingleJson: true,
      noWarnings: true,
      quiet: true,
    };
    const metadata = await this.downloadClient(youtubeUrl, flags);

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
  }

  public async downloadVideoToFile(youtubeUrl: string, outputPath?: string): Promise<string> {
    if (!youtubeUrl?.trim()) {
      throw new Error("youtube-download-service: YouTube URL is required");
    }

    outputPath ??= tmp.tmpNameSync({ postfix: ".mp4" });
    const flags: YtFlags = {
      output: outputPath,
      format: "bestvideo+bestaudio/best",
      mergeOutputFormat: "mp4",
      restrictFilenames: true,
      noWarnings: true,
      quiet: true,
    };

    try {
      await this.downloadClient(youtubeUrl, flags);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to download video: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
