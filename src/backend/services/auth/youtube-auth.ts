import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";
import { app, shell } from "electron";
import getPort from "get-port";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import { YoutubeStorage } from "../storage/youtube-storage";
import type {
  AuthResult,
  TokenData,
  UserInfo,
  VideoUploadOrigin,
  VideoUploadResult,
  YouTubeSnippetUpdate,
} from "./types";

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
  private pendingState: string | null = null;
  private pendingCodeVerifier: string | null = null;

  static getInstance() {
    YouTubeAuthService.instance ??= new YouTubeAuthService();
    return YouTubeAuthService.instance;
  }

  private getClient(port?: number) {
    const cfg = config.youtube();
    if (!cfg) throw new Error("YouTube configuration missing");
    const redirectUri = port ? `http://127.0.0.1:${port}/oauth/callback` : undefined;
    // PKCE flow - no client_secret needed
    return new OAuth2Client(cfg.clientId, undefined, redirectUri);
  }

  private async getAuthenticatedClient(): Promise<OAuth2Client> {
    const tokens = await this.storage.getYouTubeTokens();
    if (!tokens) throw new Error("No authentication tokens found");

    const client = this.getClient();
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return client;
  }

  async authenticate(): Promise<AuthResult> {
    console.log("[YouTubeAuth] authenticate() started");
    try {
      const cfg = config.youtube();
      if (!cfg) throw new Error("YouTube configuration missing");

      const port = await getPort();
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

      // Generate state for CSRF protection
      this.pendingState = this.generateState();

      // Generate PKCE code verifier and challenge (S256 method)
      this.pendingCodeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(this.pendingCodeVerifier);

      // Build auth URL manually to ensure PKCE params are correct
      console.log("client id", cfg.clientId);
      const authParams = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        state: this.pendingState,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;

      console.log("[YouTubeAuth] Opening browser for auth...");
      // Start callback server before opening browser
      const codePromise = this.startCallbackServer(port);

      // Open system browser for authentication (more secure than embedded browser)
      await shell.openExternal(authUrl);

      console.log("[YouTubeAuth] Waiting for callback...");
      const { code, state } = await codePromise;
      console.log("[YouTubeAuth] Received callback with code and state");

      // Verify state to prevent CSRF attacks
      if (state !== this.pendingState) {
        throw new Error("State mismatch - possible CSRF attack");
      }

      console.log("[YouTubeAuth] Exchanging code for tokens (manual PKCE request)...");
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          code_verifier: this.pendingCodeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        console.error("[YouTubeAuth] Token exchange failed:", errorData);
        throw new Error(errorData.error_description || errorData.error || "Token exchange failed");
      }

      const tokens = await tokenResponse.json();
      console.log("[YouTubeAuth] Token exchange result:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      if (!tokens.access_token) throw new Error("No access token received");

      const tokenData: TokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : Date.now() + DEFAULT_TOKEN_EXPIRY,
        scope: SCOPES,
      };

      console.log("[YouTubeAuth] Storing tokens and getting user info...");
      // Create a client with the new tokens for API calls
      const client = this.getClient();
      client.setCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });

      const [userInfo] = await Promise.all([
        this.getUserInfo(client),
        this.storage.storeYouTubeTokens(tokenData),
      ]);

      console.log("[YouTubeAuth] authenticate() success:", { userInfo });
      return { success: true, userInfo };
    } catch (error) {
      console.error("[YouTubeAuth] authenticate() error:", error);
      return {
        success: false,
        error: formatErrorMessage(error),
      };
    } finally {
      this.closeServer();
      this.pendingState = null;
      this.pendingCodeVerifier = null;
    }
  }

  private generateState(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Generate a PKCE code verifier (43-128 chars using unreserved characters)
   * Uses base64url encoding which produces [A-Z]/[a-z]/[0-9]/"-"/"_" characters
   */
  private generateCodeVerifier(): string {
    // 32 bytes -> 43 base64url chars (within 43-128 range required by spec)
    return randomBytes(32).toString("base64url");
  }

  /**
   * Generate PKCE code challenge using S256 method (recommended)
   * code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
   */
  private generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  private getSuccessHtml(): string {
    const protocol = config.customProtocol();
    const deeplinkUrl = protocol ? `${protocol}://youtube/auth-success` : null;

    return `<!DOCTYPE html>
<html>
<head>
  <title>YouTube Authentication Successful</title>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #ffffff; }
    .container { text-align: center; padding: 40px 60px; }
    h1 { color: #CC4141; margin-bottom: 16px; font-size: 28px; }
    p { color: #333; margin-bottom: 24px; line-height: 1.6; }
    .icon { font-size: 64px; margin-bottom: 20px; color: #CC4141; }
    a { color: #CC4141; text-decoration: underline; font-weight: 500; }
    a:hover { color: #a33535; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✓</div>
    <h1>Authentication Successful</h1>
    <p>You have successfully signed in to YouTube.</p>
    ${deeplinkUrl ? `<p><a id="deeplink" href="${deeplinkUrl}">Open YakShaver</a></p>` : "<p>You can close this window and return to YakShaver.</p>"}
  </div>
  ${
    deeplinkUrl
      ? `<script>
    (() => {
      let triggered = false;
      const link = document.getElementById('deeplink');
      const triggerDeeplink = () => {
        if (triggered) return;
        triggered = true;
        try {
          link.click();
          setTimeout(() => window.close(), 2000);
        } catch (err) {
          console.error('Failed to open app:', err);
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', triggerDeeplink, { once: true });
      } else {
        triggerDeeplink();
      }
    })();
  </script>`
      : ""
  }
</body>
</html>`;
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>YouTube Authentication Failed</title>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #ffffff; }
    .container { text-align: center; padding: 40px 60px; }
    h1 { color: #CC4141; margin-bottom: 16px; font-size: 28px; }
    p { color: #333; margin-bottom: 24px; line-height: 1.6; }
    .error { color: #CC4141; font-size: 14px; background: #fff5f5; padding: 12px; border-radius: 6px; border: 1px solid #CC4141; }
    .icon { font-size: 64px; margin-bottom: 20px; color: #CC4141; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✕</div>
    <h1>Authentication Failed</h1>
    <p>There was a problem signing in to YouTube.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>`;
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
    console.log("[YouTubeAuth] refreshTokens() called");
    try {
      const tokenData = await this.storage.getYouTubeTokens();
      if (!tokenData?.refreshToken) {
        console.log("[YouTubeAuth] No refresh token available");
        return false;
      }

      const cfg = config.youtube();
      if (!cfg) {
        console.log("[YouTubeAuth] No YouTube config");
        return false;
      }

      // Manual refresh request following Google's PKCE docs (no client_secret)
      // https://developers.google.com/youtube/v3/guides/auth/installed-apps#offline
      console.log("[YouTubeAuth] Making manual refresh request...");
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          grant_type: "refresh_token",
          refresh_token: tokenData.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("[YouTubeAuth] Refresh failed:", errorData);
        return false;
      }

      const tokens = await response.json();
      console.log("[YouTubeAuth] Refresh successful, expires_in:", tokens.expires_in);

      await this.storage.storeYouTubeTokens({
        ...tokenData,
        accessToken: tokens.access_token || tokenData.accessToken,
        // Google returns expires_in (seconds), convert to timestamp
        expiresAt: tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : Date.now() + DEFAULT_TOKEN_EXPIRY,
      });

      return true;
    } catch (error) {
      console.error("[YouTubeAuth] refreshTokens error:", error);
      return false;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.storage.getYouTubeTokens();
    console.log("[YouTubeAuth] isAuthenticated check:", {
      hasTokens: !!tokens,
      expiresAt: tokens?.expiresAt,
      now: Date.now(),
      isExpired: tokens ? tokens.expiresAt <= Date.now() : null,
    });
    if (!tokens) return false;
    if (tokens.expiresAt > Date.now()) return true;
    console.log("[YouTubeAuth] Token expired, attempting refresh...");
    const refreshed = await this.refreshTokens();
    console.log("[YouTubeAuth] Refresh result:", refreshed);
    return refreshed;
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
        error: formatErrorMessage(error),
      };
    }
  }

  private getDefaultVideoPath(): string {
    return join(app.getAppPath(), "videos", "sample.mp4");
  }

  private startCallbackServer(port: number): Promise<{ code: string; state: string }> {
    return new Promise((resolve, reject) => {
      // Set a timeout for auth flow (5 minutes)
      const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
      const timeoutId = setTimeout(() => {
        this.closeServer();
        reject(new Error("Authentication timed out. Please try again."));
      }, AUTH_TIMEOUT_MS);

      this.server = createServer((req, res) => {
        const { pathname, query } = parse(req.url || "", true);

        if (pathname !== "/oauth/callback") {
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Not Found</h1></body></html>");
          return;
        }

        const { code, state, error } = query;

        // Clear timeout since we got a response
        clearTimeout(timeoutId);

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(this.getErrorHtml(error as string), () => {
            this.closeServer();
            reject(new Error(error as string));
          });
        } else if (code && state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          // Resolve after response is sent to ensure browser receives the success page
          res.end(this.getSuccessHtml(), () => {
            this.closeServer();
            resolve({ code: code as string, state: state as string });
          });
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(this.getErrorHtml("Invalid OAuth callback - missing code or state"), () => {
            this.closeServer();
            reject(new Error("Invalid OAuth callback"));
          });
        }
      })
        .listen(port)
        .on("error", (error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
}
