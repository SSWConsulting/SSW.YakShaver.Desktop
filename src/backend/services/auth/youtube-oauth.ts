import { shell } from "electron";
import { config } from "../../config/env";
import { YoutubeStorage } from "../storage/youtube-storage";
import type { TokenData } from "./types";
import { YouTubeAuthError } from "./youtube-auth-error";

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

/** Elapsed-time helper for OAuth phase diagnostics (#596). */
function elapsedMsSince(start: number): number {
  return Math.round(Date.now() - start);
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

  // Diagnostic context for #596 — endpoint + redirectUri only, never secrets/tokens.
  console.log("[YouTubeOAuth] Requesting auth URL from backend", { endpoint, redirectUri });
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (fetchError) {
    console.error(
      `[YouTubeOAuth] auth-start fetch failed after ${elapsedMsSince(startedAt)}ms for ${endpoint}:`,
      fetchError,
    );
    throw new YouTubeAuthError(
      "backend_unreachable",
      `Failed to connect to backend at ${url.toString()}. Ensure the backend is running and SSL certificates are trusted.`,
      { cause: fetchError },
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
    console.error(
      `[YouTubeOAuth] auth-start returned ${response.status} after ${elapsedMsSince(startedAt)}ms:`,
      errorMessage,
    );
    throw new YouTubeAuthError("auth_start_failed", errorMessage, { status: response.status });
  }

  const data = await response.json();
  console.log(`[YouTubeOAuth] auth-start succeeded in ${elapsedMsSince(startedAt)}ms`);
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
  const waitStartedAt = Date.now();

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutId);
      storage.off(YoutubeStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
    };

    const onTokensUpdated = async () => {
      console.log(
        `[YouTubeOAuth] Received tokens-updated event after ${elapsedMsSince(waitStartedAt)}ms`,
      );
      const tokens = await storage.getYouTubeTokens();
      if (tokens) {
        cleanup();
        resolve(tokens);
      }
    };

    storage.on(YoutubeStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);

    timeoutId = setTimeout(() => {
      cleanup();
      const elapsedMs = elapsedMsSince(waitStartedAt);
      // Distinct, structured timeout — this is the #596 "stuck waiting" case.
      // It is NOT a hard error: the user likely never received Google's prompt.
      console.error(
        `[YouTubeOAuth] Timed out waiting for OAuth tokens after ${elapsedMs}ms (no callback received)`,
      );
      reject(
        new YouTubeAuthError("timeout", "Timed out waiting for YouTube OAuth tokens", {
          elapsedMs,
        }),
      );
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
  const flowStartedAt = Date.now();
  const authUrl = await getYouTubeAuthUrlFromBackend();
  console.log("[YouTubeOAuth] Opening browser for authentication...");
  await shell.openExternal(authUrl);
  console.log(
    `[YouTubeOAuth] Browser opened after ${elapsedMsSince(flowStartedAt)}ms; awaiting callback...`,
  );
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
