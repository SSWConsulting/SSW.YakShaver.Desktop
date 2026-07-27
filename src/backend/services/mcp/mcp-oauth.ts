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
 * The single OAuth error code (RFC 6749 §5.2) that means a refresh grant was rejected — the
 * refresh token is revoked/expired and re-authentication is required. Deliberately narrow:
 * `invalid_client` / `unauthorized_client` indicate a *client/registration* fault (often a
 * backend config blip, not the user's token) and `invalid_token` is an RFC 6750 resource-server
 * code — none mean the user's refresh token is dead, so clearing on them would sign the user
 * out over a non-token fault.
 */
const INVALID_GRANT_CODE = "invalid_grant";

/**
 * Extracts the upstream OAuth `error` code from a backend refresh error.
 *
 * The MCP refresh backend (`POST /mcp/auth/refresh`) does NOT forward the upstream OAuth error
 * verbatim. On any failure it returns HTTP 400 with `{ error: ex.Message }`, where `ex.Message`
 * is `"Token exchange failed with status <UpstreamStatus>: <raw upstream body>"` (see
 * SSWConsulting/SSW.YakShaver: `McpOAuthService.RequestAccessTokenAsync` throws it,
 * `McpEndpoints.RefreshMcpToken` wraps it as `{ error }`). So the genuine "refresh token is
 * dead" signal is the upstream `invalid_grant` code embedded inside that wrapped string — this
 * pulls it out (handling a cleanly-forwarded code, an embedded JSON body, or a form-encoded
 * body). Anything unrecognised returns undefined and is treated as transient by the caller.
 *
 * NOTE: the robust long-term fix is a backend change to forward the structured upstream OAuth
 * error (e.g. `{ error: "invalid_grant" }`) so the desktop need not parse a wrapped message.
 */
export function extractUpstreamOAuthErrorCode(rawError: string | undefined): string | undefined {
  if (!rawError) return undefined;
  // A backend that forwards the code cleanly: the whole value IS the code.
  if (/^[a-zA-Z_]+$/.test(rawError)) return rawError;
  // Embedded JSON upstream body: {"error":"invalid_grant", ...}
  const jsonMatch = rawError.match(/"error"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  // Embedded form-encoded upstream body: error=invalid_grant&... (may be preceded by the
  // backend's "...: " prefix, so allow whitespace as a boundary too).
  const formMatch = rawError.match(/(?:^|[\s?&])error=([a-zA-Z_]+)/);
  if (formMatch) return formMatch[1];
  return undefined;
}

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
/**
 * De-duplicates concurrent OAuth authorizations by serverId. Without this, a
 * single Reauthorize (which clears the token) races the health-check and
 * list-tools paths — each rediscovers "no token" and opens its own browser tab,
 * so the user gets several authorization pages for one action (#982).
 */
const inFlightAuthorizations = new Map<string, Promise<OAuthTokens>>();

export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  const existing = inFlightAuthorizations.get(serverId);
  if (existing) return existing;

  const authorization = (async () => {
    const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
    await shell.openExternal(authUrl);
    return waitForTokens(tokenStorage, serverId, timeoutMs);
  })();

  inFlightAuthorizations.set(serverId, authorization);
  try {
    return await authorization;
  } finally {
    inFlightAuthorizations.delete(serverId);
  }
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

    // The refresh token is only "dead" when the upstream provider rejected the grant with
    // `invalid_grant` (RFC 6749 §5.2). The backend wraps that upstream error inside its own
    // 400 `{ error }` message, so we extract the embedded upstream code rather than trusting
    // the status (the backend returns 400 for EVERYTHING — dead grants, missing server config,
    // upstream 5xx/timeouts wrapped as exceptions). Anything that isn't positively `invalid_grant`
    // — config errors, wrapped 5xx, rate limits, unparseable bodies — is transient, so we
    // preserve the credential and retry rather than signing the user out (#836).
    const isInvalidGrant = extractUpstreamOAuthErrorCode(errorCode) === INVALID_GRANT_CODE;

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
