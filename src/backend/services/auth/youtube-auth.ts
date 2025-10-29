import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";
import { app, shell } from "electron";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import { YoutubeStorage } from "../storage/youtube-storage";
import type { AuthResult, TokenData, UserInfo, VideoUploadResult } from "./types";

const REDIRECT_URI = "http://localhost:8080/oauth/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
];

export class YouTubeAuthService {
  private static instance: YouTubeAuthService;
  private client: OAuth2Client | null = null;
  private storage = YoutubeStorage.getInstance();
  private server: Server | null = null;

  static getInstance() {
    YouTubeAuthService.instance ??= new YouTubeAuthService();
    return YouTubeAuthService.instance;
  }

  private getClient() {
    if (!this.client) {
      const cfg = config.youtube();
      if (!cfg) throw new Error("YouTube configuration missing");
      this.client = new OAuth2Client(cfg.clientId, cfg.clientSecret, REDIRECT_URI);
    }
    return this.client;
  }

  async authenticate(): Promise<AuthResult> {
    try {
      const client = this.getClient();
      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
      });

      await shell.openExternal(authUrl);
      const { code } = await this.startCallbackServer();
      console.log(code);
      const { tokens } = await client.getToken(code);
      console.log(tokens);

      if (!tokens.access_token) throw new Error("No access token received");

      const tokenData: TokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: tokens.expiry_date || Date.now() + 3600000,
        scope: SCOPES,
      };

      client.setCredentials(tokens);
      const [userInfo] = await Promise.all([
        this.getUserInfo(client),
        this.storage.storeYouTubeTokens(tokenData),
      ]);

      return { success: true, userInfo };
    } catch (error) {
      return {
        success: false,
        error: formatErrorMessage(error),
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

  async refreshTokens(): Promise<boolean> {
    try {
      const tokenData = await this.storage.getYouTubeTokens();
      if (!tokenData?.refreshToken) return false;

      const client = this.getClient();
      client.setCredentials({ refresh_token: tokenData.refreshToken });

      const { credentials } = await client.refreshAccessToken();
      await this.storage.storeYouTubeTokens({
        ...tokenData,
        accessToken: credentials.access_token || tokenData.accessToken,
        expiresAt: credentials.expiry_date || Date.now() + 3600000,
      });

      return true;
    } catch {
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.storage.getYouTubeTokens();
    return tokens ? tokens.expiresAt > Date.now() || (await this.refreshTokens()) : false;
  }

  async getCurrentUser(): Promise<UserInfo | null> {
    try {
      const tokens = await this.storage.getYouTubeTokens();
      if (!tokens) return null;

      const client = this.getClient();
      client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      return await this.getUserInfo(client);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    await this.storage.clearYouTubeTokens();
    this.client = null;
  }

  async uploadVideo(videoFilePath?: string): Promise<VideoUploadResult> {
    try {
      if (!(await this.isAuthenticated())) {
        return { success: false, error: "Not authenticated" };
      }

      const tokens = await this.storage.getYouTubeTokens();
      if (!tokens) {
        return { success: false, error: "No authentication tokens found" };
      }

      const client = this.getClient();
      client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

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
            categoryId: "22",
          },
          status: { privacyStatus: "unlisted" },
        },
        media: { body: createReadStream(videoPath) },
      });

      const { id: videoId, snippet } = response.data;

      return {
        success: true,
        data: {
          title: snippet?.title || "Untitled",
          description: snippet?.description || "",
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
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

  private startCallbackServer(): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        const { pathname, query } = parse(req.url || "", true);

        if (pathname !== "/oauth/callback") {
          res.writeHead(404).end("Not Found");
          return;
        }

        const { code, error } = query;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

        if (error) {
          res.end(this.renderPage("Authentication Failed", error as string));
          reject(new Error(error as string));
        } else if (code) {
          res.end(this.renderPage("Authentication Successful", "You can close this window."));
          resolve({ code: code as string });
        } else {
          res.end(this.renderPage("Invalid Response", "Please try again."));
          reject(new Error("Invalid OAuth callback"));
        }

        this.server?.close();
        this.server = null;
      })
        .listen(8080)
        .on("error", reject);
    });
  }

  private renderPage(title: string, msg: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
</head>
<body style="margin:0;font-family:system-ui;background:#1a1a1a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="background:#2a2a2a;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:3rem 2rem;max-width:400px;text-align:center">
    <h1 style="font-size:1.5rem;margin-bottom:.75rem">${title}</h1>
    <p style="color:#999;line-height:1.5">${msg}</p>
  </div>
</body>
</html>`;
  }
}
