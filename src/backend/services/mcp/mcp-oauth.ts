import type { OAuthTokens } from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import { delay } from "../../utils/async-utils";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

/**
 * Error thrown when an MCP OAuth token refresh fails.
 *
 * `isInvalidGrant` distinguishes the two cases that #836 hinged on:
 *  - `true`  — the backend rejected the refresh token itself (revoked / expired /
 *              `invalid_grant`). The credential is genuinely dead, so clearing the
 *              stored tokens and asking the user to reconnect is correct.
 *  - `false` — a *transient* failure (network/SSL drop, 5xx, 429, timeout). The
 *              refresh token is probably still valid, so the caller MUST preserve it
 *              and retry later rather than signing the user out.
 */
export class McpTokenRefreshError extends Error {
  readonly status?: number;
  readonly isInvalidGrant: boolean;

  constructor(
    message: string,
    options: { status?: number; isInvalidGrant?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "McpTokenRefreshError";
    this.status = options.status;
    this.isInvalidGrant = options.isInvalidGrant ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  /** True for transient failures where the refresh token should be preserved and retried. */
  get isTransient(): boolean {
    return !this.isInvalidGrant;
  }
}

/**
 * Whether an error represents a refresh token the backend has positively rejected
 * (so it is safe to clear and re-authenticate). Anything else — including unknown
 * error shapes — is treated as transient, so we default to preserving credentials.
 */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  return error instanceof McpTokenRefreshError && error.isInvalidGrant;
}

/**
 * OAuth error codes that mean the refresh token is no longer usable. Per RFC 6749 §5.2
 * a rejected grant comes back as `invalid_grant`; the others cover backends that surface
 * a revoked client/token differently.
 */
const INVALID_GRANT_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_token",
  "unauthorized_client",
  "invalid_client",
]);

/**
 * Gets the authorization URL from the .NET backend for an MCP server.
 */
export async function getAuthUrlFromBackend(serverUrl: string, serverId: string): Promise<string> {
  const portalApiUrl = config.portalApiUrl();
  const protocol =
    config.azure()?.customProtocol ||
    (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");
  const redirectUri = `${protocol}://oauth/callback?serverId=${encodeURIComponent(serverId)}`;
  const endpoint = "/mcp/auth/start";
  const url = new URL(`${portalApiUrl}${endpoint}`);
  url.searchParams.set("serverUrl", serverUrl);
  url.searchParams.set("redirectUri", redirectUri);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (fetchError) {
    console.error(`[McpOAuth] Fetch failed for ${url.toString()}:`, fetchError);
    throw new Error(
      `Failed to connect to backend at ${url.toString()}. Ensure the backend is running and SSL certificates are trusted.`,
    );
  }

  if (!response.ok) {
    let errorMessage = "Failed to get authorization URL from backend";
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
 * Waits for tokens to be available for a given server ID using an event-driven approach.
 */
export async function waitForTokens(
  tokenStorage: McpOAuthTokenStorage,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  // 1. Check immediately if tokens are already there
  const existingTokens = await tokenStorage.getTokensAsync(serverId);
  if (existingTokens) {
    console.log(`[McpOAuth] Tokens already present for server ${serverId}`);
    return existingTokens;
  }

  console.log(`[McpOAuth] Waiting for tokens for server ${serverId} (Timeout: ${timeoutMs}ms)...`);

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutId);
      tokenStorage.off(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
    };

    const onTokensUpdated = async (updatedServerId: string) => {
      if (updatedServerId === serverId) {
        console.log(`[McpOAuth] Received tokens-updated event for server ${serverId}`);
        const tokens = await tokenStorage.getTokensAsync(serverId);
        if (tokens) {
          cleanup();
          resolve(tokens);
        }
      }
    };

    tokenStorage.on(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);

    timeoutId = setTimeout(() => {
      cleanup();
      console.error(`[McpOAuth] Timed out waiting for OAuth tokens for server ${serverId}`);
      reject(new Error(`Timed out waiting for OAuth tokens for server ${serverId}`));
    }, timeoutMs);
  });
}

/**
 * Initiates the OAuth flow using the .NET backend.
 */
export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
  await shell.openExternal(authUrl);
  return waitForTokens(tokenStorage, serverId, timeoutMs);
}

/**
 * Refreshes the OAuth tokens using the .NET backend.
 *
 * On failure this throws a {@link McpTokenRefreshError} that classifies whether the
 * refresh token was genuinely rejected (`isInvalidGrant`) or the call failed
 * transiently — so callers can decide whether to clear credentials or retry (#836).
 */
export async function refreshTokenWithBackend(
  serverUrl: string,
  refreshToken: string,
): Promise<OAuthTokens> {
  const portalApiUrl = config.portalApiUrl();
  const endpoint = "/mcp/auth/refresh";
  const url = `${portalApiUrl}${endpoint}`;

  console.log(`[McpOAuth] Refreshing tokens for ${serverUrl}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        serverUrl,
        refreshToken,
      }),
    });
  } catch (fetchError) {
    // Network / SSL / DNS failure — transient by definition. Preserve the refresh token.
    throw new McpTokenRefreshError(`Network error refreshing tokens for ${serverUrl}`, {
      isInvalidGrant: false,
      cause: fetchError,
    });
  }

  if (!response.ok) {
    let errorMessage = "Failed to refresh tokens from backend";
    let errorCode: string | undefined;
    try {
      const errorData = await response.json();
      errorCode = typeof errorData?.error === "string" ? errorData.error : undefined;
      errorMessage = errorData?.error_description || errorData?.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage} (Status: ${response.status})`;
    }

    // The refresh token is only "dead" when the backend positively rejects the grant.
    // A 5xx / 429 / 408 (or any unrecognised error) is transient — keep the token.
    const isInvalidGrant =
      (errorCode !== undefined && INVALID_GRANT_ERROR_CODES.has(errorCode)) ||
      response.status === 400 ||
      response.status === 401;

    throw new McpTokenRefreshError(errorMessage, {
      status: response.status,
      isInvalidGrant,
    });
  }

  return await response.json();
}

/**
 * Refreshes tokens with a bounded retry on *transient* failures, so a single network
 * blip or backend hiccup coinciding with token expiry no longer signs the user out
 * (#836). A genuine `invalid_grant` is not retried — it is rethrown immediately so the
 * caller can clear the dead credential.
 */
export async function refreshTokenWithBackendWithRetry(
  serverUrl: string,
  refreshToken: string,
  options: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<OAuthTokens> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? delay;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await refreshTokenWithBackend(serverUrl, refreshToken);
    } catch (error) {
      lastError = error;
      // Do not retry a positively-rejected refresh token — retrying cannot help.
      if (isInvalidRefreshTokenError(error)) {
        throw error;
      }
      if (attempt < retries) {
        const backoffMs = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[McpOAuth] Transient token refresh failure for ${serverUrl} (attempt ${attempt}/${retries}); retrying in ${backoffMs}ms.`,
        );
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
}
