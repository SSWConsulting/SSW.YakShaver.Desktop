import type { OAuthTokens } from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import { delay } from "../../utils/async-utils";
import { IdentityServerAuthService } from "../auth/identity-server-auth";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

export type McpOAuthProvider = "github" | "azure-devops";

export interface McpOAuthAuthorizeOptions {
  provider?: McpOAuthProvider;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface McpOAuthSession {
  authorizationUrl: string;
  state: string;
}

export const DEFAULT_MCP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1500;
const OAUTH_TIMEOUT_ERROR = "MCP OAuth session timed out. Reconnect the MCP server.";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRequiredString(
  value: Record<string, unknown>,
  key: string,
  responseName: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${responseName} did not include a valid ${key}`);
  }
  return field;
}

function parseOAuthSession(value: unknown): McpOAuthSession {
  if (!isRecord(value)) {
    throw new Error("MCP OAuth start response was invalid");
  }

  return {
    authorizationUrl: getRequiredString(value, "authorizationUrl", "MCP OAuth start response"),
    state: getRequiredString(value, "state", "MCP OAuth start response"),
  };
}

function parseOAuthTokens(value: unknown): OAuthTokens {
  if (!isRecord(value)) {
    throw new Error("MCP OAuth result response was invalid");
  }

  const accessToken = getRequiredString(value, "access_token", "MCP OAuth result response");
  const refreshToken = getRequiredString(value, "refresh_token", "MCP OAuth result response");

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: typeof value.token_type === "string" ? value.token_type : "bearer",
    ...(typeof value.expires_in === "number" ? { expires_in: value.expires_in } : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
  };
}

export function inferMcpOAuthProvider(serverUrl: string): McpOAuthProvider | undefined {
  const hostname = new URL(serverUrl).hostname.toLowerCase();

  if (hostname.includes("github")) {
    return "github";
  }

  if (
    hostname === "dev.azure.com" ||
    hostname.endsWith(".azure.com") ||
    hostname.endsWith(".visualstudio.com")
  ) {
    return "azure-devops";
  }

  return undefined;
}

async function getPortalAccessToken(): Promise<string> {
  const accessToken = await IdentityServerAuthService.getInstance().getAccessToken();
  if (!accessToken) {
    throw new Error("Sign in to YakShaver before connecting an MCP server");
  }
  return accessToken;
}

async function startRecoverableOAuth(
  serverUrl: string,
  provider: McpOAuthProvider,
  accessToken: string,
): Promise<McpOAuthSession> {
  const url = new URL(`${config.portalApiUrl()}/mcp/auth/start`);
  url.searchParams.set("serverUrl", serverUrl);
  url.searchParams.set("provider", provider);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to start MCP OAuth (Status: ${response.status})`);
  }

  const data: unknown = await response.json();
  return parseOAuthSession(data);
}

async function getRecoverableOAuthResult(
  serverUrl: string,
  state: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<OAuthTokens | undefined> {
  const url = new URL(`${config.portalApiUrl()}/mcp/auth/result`);
  url.searchParams.set("serverUrl", serverUrl);
  url.searchParams.set("state", state);

  const response = await fetch(url.toString(), {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 202) {
    return undefined;
  }

  if (response.status === 404) {
    throw new Error("MCP OAuth session expired or was already used. Reconnect the MCP server.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Your YakShaver sign-in expired. Sign in again before reconnecting.");
  }

  if (!response.ok) {
    throw new Error(`Failed to retrieve MCP OAuth result (Status: ${response.status})`);
  }

  const data: unknown = await response.json();
  return parseOAuthTokens(data);
}

function delayUntilNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("MCP OAuth result polling was cancelled"));
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error("MCP OAuth result polling was cancelled"));
    };
    timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function pollRecoverableOAuthResult(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  state: string,
  timeoutMs: number,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<OAuthTokens> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && !signal.aborted) {
    const currentAccessToken = await getPortalAccessToken();
    const tokens = await getRecoverableOAuthResult(serverUrl, state, currentAccessToken, signal);
    if (tokens) {
      const completed = await tokenStorage.completeOAuthAsync(serverId, tokens);
      if (completed) {
        return tokens;
      }

      const previouslyCompletedTokens = await tokenStorage.getTokensAsync(serverId);
      if (previouslyCompletedTokens) {
        return previouslyCompletedTokens;
      }
    }
    await delayUntilNextPoll(pollIntervalMs, signal);
  }

  throw new Error(OAUTH_TIMEOUT_ERROR);
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
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  if (signal?.aborted) {
    throw new Error("MCP OAuth token wait was cancelled");
  }

  // 1. Check immediately if tokens are already there
  const existingTokens = await tokenStorage.getTokensAsync(serverId);
  if (existingTokens) {
    console.log(`[McpOAuth] Tokens already present for server ${serverId}`);
    return existingTokens;
  }

  console.log(`[McpOAuth] Waiting for tokens for server ${serverId} (Timeout: ${timeoutMs}ms)...`);

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | undefined;

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      tokenStorage.off(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
      signal?.removeEventListener("abort", onAbort);
    }

    function onAbort() {
      cleanup();
      reject(new Error("MCP OAuth token wait was cancelled"));
    }

    const resolveStoredTokens = async () => {
      const tokens = await tokenStorage.getTokensAsync(serverId);
      if (tokens) {
        cleanup();
        resolve(tokens);
      }
    };

    const onTokensUpdated = (updatedServerId: string) => {
      if (updatedServerId !== serverId) return;

      console.log(`[McpOAuth] Received tokens-updated event for server ${serverId}`);
      void resolveStoredTokens().catch((error: unknown) => {
        cleanup();
        reject(error);
      });
    };

    tokenStorage.on(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
    signal?.addEventListener("abort", onAbort, { once: true });

    timeoutId = setTimeout(() => {
      cleanup();
      console.error(`[McpOAuth] Timed out waiting for OAuth tokens for server ${serverId}`);
      reject(new Error(OAUTH_TIMEOUT_ERROR));
    }, timeoutMs);

    // Close the gap between the initial lookup and listener registration.
    void resolveStoredTokens().catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Initiates the OAuth flow using the .NET backend.
 */
export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  options: number | McpOAuthAuthorizeOptions = {},
): Promise<OAuthTokens> {
  const normalizedOptions = typeof options === "number" ? { timeoutMs: options } : options;
  const timeoutMs = normalizedOptions.timeoutMs ?? DEFAULT_MCP_AUTH_TIMEOUT_MS;
  const provider = normalizedOptions.provider ?? inferMcpOAuthProvider(serverUrl);

  if (!provider) {
    const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
    await shell.openExternal(authUrl);
    return waitForTokens(tokenStorage, serverId, timeoutMs);
  }

  const accessToken = await getPortalAccessToken();
  const session = await startRecoverableOAuth(serverUrl, provider, accessToken);
  const pollingAbortController = new AbortController();
  const deepLinkAbortController = new AbortController();
  const deepLinkTokens = waitForTokens(
    tokenStorage,
    serverId,
    timeoutMs,
    deepLinkAbortController.signal,
  );
  const polledTokens = pollRecoverableOAuthResult(
    tokenStorage,
    serverUrl,
    serverId,
    session.state,
    timeoutMs,
    normalizedOptions.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollingAbortController.signal,
  );

  try {
    await shell.openExternal(session.authorizationUrl);
    return await Promise.race([deepLinkTokens, polledTokens]);
  } finally {
    pollingAbortController.abort();
    deepLinkAbortController.abort();
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
