import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { formatAndReportError } from "../../utils/error-utils";
import { YoutubeStorage } from "../storage/youtube-storage";
import type {
  AuthResult,
  UserInfo,
  VideoUploadOrigin,
  VideoUploadResult,
  YouTubeSnippetUpdate,
} from "./types";
import {
  authorizeYouTubeWithBackend,
  convertToTokenData,
  refreshYouTubeTokenWithBackend,
} from "./youtube-oauth";

export class YouTubeClient {
  private static instance: YouTubeClient;
  private storage = YoutubeStorage.getInstance();

  static getInstance() {
    YouTubeClient.instance ??= new YouTubeClient();
    return YouTubeClient.instance;
  }

  /**
   * Creates an OAuth2Client with the stored access token for making API calls.
   */
  private async getAuthenticatedClient(): Promise<OAuth2Client> {
    const tokens = await this.storage.getYouTubeTokens();
    if (!tokens) throw new Error("No authentication tokens found");

    const client = new OAuth2Client();
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return client;
  }

  /**
   * Initiates the OAuth flow using the .NET backend.
   * Opens the system browser for authentication and waits for tokens via protocol callback.
   */
  async authenticate(): Promise<AuthResult> {
    try {
      console.log("[YouTubeClient] Starting authentication via backend...");

      // Use backend OAuth flow - opens browser and waits for callback
      // Tokens are stored via protocol callback, we just need to wait for completion
      await authorizeYouTubeWithBackend(this.storage);

      console.log("[YouTubeClient] Authentication successful, fetching user info...");

      // Get user info after successful authentication
      const userInfo = await this.getCurrentUser();

      return { success: true, userInfo: userInfo ?? undefined };
    } catch (error) {
      console.error("[YouTubeClient] Authentication failed:", error);
      return {
        success: false,
        error: formatAndReportError(error, "youtube_upload"),
      };
    }
  }

  private async getUserInfo(client: OAuth2Client): Promise<UserInfo> {
    const [userRes, channelRes] = await Promise.all([
      google.oauth2({ version: "v2", auth: client }).userinfo.get(),
      google
        .youtube({ version: "v3", auth: client })
        .channels.list({ part: ["snippet"], mine: true }),
    ]);

    const user = userRes.data;
    const channel = channelRes.data.items?.[0];

    return {
      id: user.id || "",
      name: user.name || "",
      email: user.email || "",
      avatar: user.picture || undefined,
      channelName: channel?.snippet?.title || undefined,
    };
  }

  /**
   * Refreshes the access token using the .NET backend.
   */
  async refreshTokens(): Promise<boolean> {
    try {
      const tokenData = await this.storage.getYouTubeTokens();
      if (!tokenData?.refreshToken) {
        console.log("[YouTubeClient] No refresh token available");
        return false;
      }

      console.log("[YouTubeClient] Refreshing tokens via backend...");

      const response = await refreshYouTubeTokenWithBackend(tokenData.refreshToken);
      const newTokenData = convertToTokenData(response, tokenData);

      await this.storage.storeYouTubeTokens(newTokenData);

      console.log("[YouTubeClient] Tokens refreshed successfully");
      return true;
    } catch (error) {
      console.error("[YouTubeClient] Failed to refresh tokens:", error);
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.storage.getYouTubeTokens();
    if (!tokens) return false;

    // If token is not expired, we're authenticated
    if (tokens.expiresAt > Date.now()) return true;

    // Try to refresh the token
    return await this.refreshTokens();
  }

  async getCurrentUser(): Promise<UserInfo | null> {
    try {
      const client = await this.getAuthenticatedClient();
      return await this.getUserInfo(client);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    await this.storage.clearYouTubeTokens();
  }

  async uploadVideo(videoFilePath?: string): Promise<VideoUploadResult> {
    try {
      if (!(await this.isAuthenticated())) {
        return { success: false, error: "Not authenticated" };
      }

      const client = await this.getAuthenticatedClient();

      // Use provided file path or fall back to default sample video
      const videoPath = videoFilePath || this.getDefaultVideoPath();
      if (!existsSync(videoPath)) {
        return { success: false, error: "Video file not found" };
      }

      const youtube = google.youtube({ version: "v3", auth: client });
      const response = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: "Uploaded Video",
            description: "Video uploaded via Desktop Electron App",
            tags: ["electron", "upload"],
            categoryId: "28",
          },
          status: { privacyStatus: "unlisted" },
        },
        media: { body: createReadStream(videoPath) },
      });

      const { id: videoId, snippet } = response.data;

      if (!videoId) {
        return { success: false, error: "Failed to retrieve uploaded video ID" };
      }

      return {
        success: true,
        data: {
          videoId,
          title: snippet?.title || "Untitled",
          description: snippet?.description || "",
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
        origin: "upload",
      };
    } catch (error) {
      return {
        success: false,
        error: formatAndReportError(error, "youtube_upload"),
      };
    }
  }

  async updateVideoMetadata(
    videoId: string,
    snippet: YouTubeSnippetUpdate,
    origin: VideoUploadOrigin = "upload",
  ): Promise<VideoUploadResult> {
    try {
      if (!(await this.isAuthenticated())) {
        return { success: false, error: "Not authenticated" };
      }

      if (!videoId?.trim()) {
        return { success: false, error: "Video ID is required" };
      }

      if (origin === "external") {
        return {
          success: false,
          error: "Cannot update metadata for externally sourced videos",
        };
      }

      const client = await this.getAuthenticatedClient();
      const youtube = google.youtube({ version: "v3", auth: client });
      const response = await youtube.videos.update({
        part: ["snippet"],
        requestBody: {
          id: videoId,
          snippet: {
            ...snippet,
            categoryId: snippet.categoryId ?? "28",
          },
        },
      });

      const updatedSnippet = response.data.snippet ?? snippet;

      return {
        success: true,
        data: {
          videoId,
          title: updatedSnippet.title || snippet.title,
          description: updatedSnippet.description || snippet.description,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
        origin,
      };
    } catch (error) {
      return {
        success: false,
        error: formatAndReportError(error, "youtube_upload"),
      };
    }
  }

  private getDefaultVideoPath(): string {
    return join(app.getAppPath(), "videos", "sample.mp4");
  }
}
