import fs from "node:fs/promises";
import ytDlp, { create as createYtDlp, type YtFlags } from "yt-dlp-exec";
import tmp from "tmp";
import { formatErrorMessage } from "../../utils/error-utils";

tmp.setGracefulCleanup();

export interface YouTubeVideoMetadata {
  title: string;
  url: string;
  description?: string;
  authorName?: string;
  thumbnailUrl?: string;
}

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

  async fetchVideoMetadata(youtubeUrl: string): Promise<YouTubeVideoMetadata | null> {
    if (!youtubeUrl?.trim()) {
      return null;
    }

    try {
      const endpoint = new URL("https://www.youtube.com/oembed");
      endpoint.searchParams.set("url", youtubeUrl);
      endpoint.searchParams.set("format", "json");

      const response = await fetch(endpoint);
      if (!response.ok) {
        console.warn(
          "[youtube-download-service] metadata fetch failed",
          response.status,
          response.statusText,
        );
        return null;
      }

      type OEmbedResponse = {
        title: string;
        author_name?: string;
        thumbnail_url?: string;
      };

      const data = (await response.json()) as OEmbedResponse;

      return {
        title: data.title,
        url: youtubeUrl,
        authorName: data.author_name,
        thumbnailUrl: data.thumbnail_url,
        description: data.author_name ? `Existing video by ${data.author_name}` : undefined,
      };
    } catch (error) {
      console.warn("[youtube-download-service] metadata fetch threw", error);
      return null;
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

