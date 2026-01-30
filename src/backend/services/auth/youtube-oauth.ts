import { shell } from "electron";
import { config } from "../../config/env";
import { YoutubeStorage } from "../storage/youtube-storage";
import type { TokenData } from "./types";

/**
 * Response from the backend OAuth token endpoint.
 */
interface YouTubeTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Gets the authorization URL from the .NET backend for YouTube OAuth.
 */
export async function getYouTubeAuthUrlFromBackend(): Promise<string> {
  const portalApiUrl = config.portalApiUrl();
  const protocol =
    config.azure()?.customProtocol ||
    (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");
  const redirectUri = `${protocol}://youtube/oauth/callback`;
  const endpoint = "/desktop-video-hostings/youtube/auth/start";
  const url = new URL(`${portalApiUrl}${endpoint}`);
  url.searchParams.set("redirectUri", redirectUri);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (fetchError) {
    console.error(`[YouTubeOAuth] Fetch failed for ${url.toString()}:`, fetchError);
    throw new Error(
      `Failed to connect to backend at ${url.toString()}. Ensure the backend is running and SSL certificates are trusted.`,
    );
  }

  if (!response.ok) {
    let errorMessage = "Failed to get YouTube authorization URL from backend";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage} (Status: ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.authorizationUrl;
}

/**
 * Waits for YouTube tokens to be stored after OAuth callback.
 */
export async function waitForYouTubeTokens(
  storage: YoutubeStorage,
  timeoutMs: number = 60000,
): Promise<TokenData> {
  // Check immediately if tokens are already there
  const existingTokens = await storage.getYouTubeTokens();
  if (existingTokens) {
    console.log("[YouTubeOAuth] Tokens already present");
    return existingTokens;
  }

  console.log(`[YouTubeOAuth] Waiting for tokens (Timeout: ${timeoutMs}ms)...`);

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutId);
      storage.off(YoutubeStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
    };

    const onTokensUpdated = async () => {
      console.log("[YouTubeOAuth] Received tokens-updated event");
      const tokens = await storage.getYouTubeTokens();
      if (tokens) {
        cleanup();
        resolve(tokens);
      }
    };

    storage.on(YoutubeStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);

    timeoutId = setTimeout(() => {
      cleanup();
      console.error("[YouTubeOAuth] Timed out waiting for OAuth tokens");
      reject(new Error("Timed out waiting for YouTube OAuth tokens"));
    }, timeoutMs);
  });
}

/**
 * Initiates the YouTube OAuth flow using the .NET backend.
 * Opens the browser for user authentication and waits for tokens.
 */
export async function authorizeYouTubeWithBackend(
  storage: YoutubeStorage,
  timeoutMs: number = 60000,
): Promise<TokenData> {
  const authUrl = await getYouTubeAuthUrlFromBackend();
  console.log("[YouTubeOAuth] Opening browser for authentication...");
  await shell.openExternal(authUrl);
  return waitForYouTubeTokens(storage, timeoutMs);
}

/**
 * Refreshes the YouTube OAuth tokens using the .NET backend.
 */
export async function refreshYouTubeTokenWithBackend(
  refreshToken: string,
): Promise<YouTubeTokenResponse> {
  const portalApiUrl = config.portalApiUrl();
  const endpoint = "/desktop-video-hostings/youtube/auth/refresh";
  const url = `${portalApiUrl}${endpoint}`;

  console.log("[YouTubeOAuth] Refreshing tokens via backend...");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to refresh YouTube tokens from backend";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage} (Status: ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}

/**
 * Converts backend token response to TokenData format used by the app.
 */
export function convertToTokenData(
  response: YouTubeTokenResponse,
  existingTokens?: TokenData | null,
): TokenData {
  const expiresIn = response.expires_in ?? 3600;
  const scope = response.scope?.split(" ") ?? existingTokens?.scope ?? [];

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? existingTokens?.refreshToken ?? "",
    expiresAt: Date.now() + expiresIn * 1000,
    scope,
  };
}
