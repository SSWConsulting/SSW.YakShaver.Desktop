import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { formatErrorMessage } from "../../utils/error-utils";
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

  private async getAccessToken(): Promise<string> {
    const tokens = await this.storage.getYouTubeTokens();
    if (!tokens) throw new Error("No authentication tokens found");
    return tokens.accessToken;
  }

  /**
   * Initiates the OAuth flow using the .NET backend.
   * Opens the system browser for authentication and waits for tokens via protocol callback.
   */
  async authenticate(): Promise<AuthResult> {
    try {
      console.log("[YouTubeClient] Starting authentication via backend...");

      // Clear stale tokens so waitForYouTubeTokens actually waits for
      // fresh tokens from the protocol callback instead of returning immediately.
      await this.storage.clearYouTubeTokens();

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
        error: formatErrorMessage(error),
      };
    }
  }

  /**
   * Fetches user profile and YouTube channel info via direct HTTP requests.
   * The googleapis library uses its own HTTP transport (gaxios/node-http),
   * not the global fetch, so it bypasses the Chromium network stack override
   * and hangs in Electron's main process.
   */
  private async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const headers = { Authorization: `Bearer ${accessToken}` };

    const [userRes, channelRes] = await Promise.all([
      fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers }),
      fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers }),
    ]);

    if (!userRes.ok) {
      throw new Error(`Google UserInfo request failed (${userRes.status})`);
    }
    if (!channelRes.ok) {
      throw new Error(`YouTube Channels request failed (${channelRes.status})`);
    }

    // Response shapes are well-known Google API contracts
    const user = (await userRes.json()) as Record<string, unknown>;
    const channelData = (await channelRes.json()) as Record<string, unknown>;
    const items = Array.isArray(channelData.items) ? channelData.items : [];
    const snippet = (items[0] as Record<string, unknown> | undefined)?.snippet as
      | Record<string, unknown>
      | undefined;

    return {
      id: String(user.id ?? ""),
      name: String(user.name ?? ""),
      email: String(user.email ?? ""),
      avatar: typeof user.picture === "string" ? user.picture : undefined,
      channelName: typeof snippet?.title === "string" ? snippet.title : undefined,
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
      const tokens = await this.storage.getYouTubeTokens();
      if (!tokens) return null;
      return await this.fetchUserInfo(tokens.accessToken);
    } catch (error) {
      console.error("[YouTubeClient] Failed to fetch user info:", error);
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

      const accessToken = await this.getAccessToken();

      const videoPath = videoFilePath || this.getDefaultVideoPath();
      if (!existsSync(videoPath)) {
        return { success: false, error: "Video file not found" };
      }

      const metadata = {
        snippet: {
          title: "Uploaded Video",
          description: "Video uploaded via Desktop Electron App",
          tags: ["electron", "upload"],
          categoryId: "28",
        },
        status: { privacyStatus: "unlisted" },
      };

      // Step 1: Initiate resumable upload via YouTube Data API v3
      const initUrl =
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
      const initRes = await fetch(initUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
      });

      if (!initRes.ok) {
        const errorBody = await initRes.text();
        throw new Error(`Failed to initiate upload (${initRes.status}): ${errorBody}`);
      }

      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) {
        throw new Error("No upload URL returned from YouTube API");
      }

      // Step 2: Upload the video file to the resumable session URI
      const videoBuffer = await readFile(videoPath);
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/*",
          "Content-Length": String(videoBuffer.byteLength),
        },
        body: videoBuffer,
      });

      if (!uploadRes.ok) {
        const errorBody = await uploadRes.text();
        throw new Error(`Video upload failed (${uploadRes.status}): ${errorBody}`);
      }

      const responseData = (await uploadRes.json()) as Record<string, unknown>;
      const videoId = String(responseData.id ?? "");
      const snippetData = responseData.snippet as Record<string, unknown> | undefined;

      if (!videoId) {
        return { success: false, error: "Failed to retrieve uploaded video ID" };
      }

      return {
        success: true,
        data: {
          videoId,
          title: typeof snippetData?.title === "string" ? snippetData.title : "Untitled",
          description:
            typeof snippetData?.description === "string" ? snippetData.description : "",
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
        origin: "upload",
      };
    } catch (error) {
      return {
        success: false,
        error: formatErrorMessage(error),
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

      const accessToken = await this.getAccessToken();
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?part=snippet",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: videoId,
            snippet: {
              ...snippet,
              categoryId: snippet.categoryId ?? "28",
            },
          }),
        },
      );

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Update metadata failed (${res.status}): ${errorBody}`);
      }

      const responseData = (await res.json()) as Record<string, unknown>;
      const updatedSnippet = responseData.snippet as Record<string, unknown> | undefined;

      return {
        success: true,
        data: {
          videoId,
          title:
            typeof updatedSnippet?.title === "string" ? updatedSnippet.title : snippet.title,
          description:
            typeof updatedSnippet?.description === "string"
              ? updatedSnippet.description
              : snippet.description,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
        origin,
      };
    } catch (error) {
      return {
        success: false,
        error: formatErrorMessage(error),
      };
    }
  }

  private getDefaultVideoPath(): string {
    return join(app.getAppPath(), "videos", "sample.mp4");
  }
}
