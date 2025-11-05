import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";
import { app, BrowserWindow } from "electron";
import getPort from "get-port";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import { YoutubeStorage } from "../storage/youtube-storage";
import type { AuthResult, TokenData, UserInfo, VideoUploadResult } from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
];

const DEFAULT_TOKEN_EXPIRY = 3600000;

export class YouTubeAuthService {
  private static instance: YouTubeAuthService;
  private storage = YoutubeStorage.getInstance();
  private server: Server | null = null;
  private authWindow: BrowserWindow | null = null;
  private pendingState: string | null = null;

  static getInstance() {
    YouTubeAuthService.instance ??= new YouTubeAuthService();
    return YouTubeAuthService.instance;
  }

  private getClient(port: number) {
    const cfg = config.youtube();
    if (!cfg) throw new Error("YouTube configuration missing");
    const redirectUri = `http://localhost:${port}/oauth/callback`;
    return new OAuth2Client(cfg.clientId, cfg.clientSecret, redirectUri);
  }

  private async getAuthenticatedClient(): Promise<OAuth2Client> {
    const tokens = await this.storage.getYouTubeTokens();
    if (!tokens) throw new Error("No authentication tokens found");

    const client = this.getClient(await getPort());
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return client;
  }

  async authenticate(): Promise<AuthResult> {
    try {
      const port = await getPort();
      const client = this.getClient(port);

      // Generate state for CSRF protection
      this.pendingState = this.generateState();

      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
        state: this.pendingState,
      });

      this.authWindow = this.createAuthWindow();
      const codePromise = this.startCallbackServer(this.authWindow, port);

      await this.authWindow.loadURL(authUrl);

      const { code, state } = await codePromise;

      // Verify state to prevent CSRF attacks
      if (state !== this.pendingState) {
        throw new Error("State mismatch");
      }

      const { tokens } = await client.getToken(code);

      if (!tokens.access_token) throw new Error("No access token received");

      const tokenData: TokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: tokens.expiry_date || Date.now() + DEFAULT_TOKEN_EXPIRY,
        scope: SCOPES,
      };

      client.setCredentials(tokens);
      const [userInfo] = await Promise.all([
        this.getUserInfo(client),
        this.storage.storeYouTubeTokens(tokenData),
      ]);

      this.closeAuthWindow();
      return { success: true, userInfo };
    } catch (error) {
      this.closeAuthWindow();
      this.closeServer();
      return {
        success: false,
        error: formatErrorMessage(error),
      };
    } finally {
      this.pendingState = null;
    }
  }

  private generateState(): string {
    return randomBytes(32).toString("hex");
  }

  private createAuthWindow(): BrowserWindow {
    const authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        // Use a persistent partition to avoid cache conflicts
        partition: "persist:youtube-auth",
      },
      title: "Sign in to YouTube",
      autoHideMenuBar: true,
    });

    return authWindow;
  }

  private closeAuthWindow(): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      // Remove all listeners before closing to prevent memory leaks
      this.authWindow.removeAllListeners();
      this.authWindow.close();
      this.authWindow = null;
    }
  }

  private closeServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
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

      const client = this.getClient(await getPort());
      client.setCredentials({ refresh_token: tokenData.refreshToken });

      const { credentials } = await client.refreshAccessToken();
      await this.storage.storeYouTubeTokens({
        ...tokenData,
        accessToken: credentials.access_token || tokenData.accessToken,
        expiresAt: credentials.expiry_date || Date.now() + DEFAULT_TOKEN_EXPIRY,
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
      const client = await this.getAuthenticatedClient();
      return await this.getUserInfo(client);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    await this.storage.clearYouTubeTokens();
    this.closeAuthWindow();
    this.closeServer();
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

  private startCallbackServer(
    authWindow: BrowserWindow,
    port: number,
  ): Promise<{ code: string; state: string }> {
    return new Promise((resolve, reject) => {
      // Handle window closure
      const handleWindowClose = () => {
        reject(new Error("Authentication cancelled by user"));
        this.closeServer();
      };

      authWindow.once("closed", handleWindowClose);

      this.server = createServer((req, res) => {
        const { pathname, query } = parse(req.url || "", true);

        if (pathname !== "/oauth/callback") {
          res.writeHead(404).end("Not Found");
          return;
        }

        const { code, state, error } = query;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

        // Remove the window close listener since we got a response
        authWindow.removeListener("closed", handleWindowClose);

        if (error) {
          reject(new Error(error as string));
        } else if (code && state) {
          resolve({ code: code as string, state: state as string });
          this.closeAuthWindow();
        } else {
          reject(new Error("Invalid OAuth callback"));
        }
        this.closeServer();
      })
        .listen(port)
        .on("error", (error) => {
          authWindow.removeListener("closed", handleWindowClose);
          reject(error);
        });
    });
  }
}
