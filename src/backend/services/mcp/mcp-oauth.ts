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

interface McpOAuthStartRequestOptions {
  provider?: McpOAuthProvider;
  accessToken?: string;
}

const OAUTH_TIMEOUT_ERROR = "MCP OAuth session timed out. Reconnect the MCP server.";

class McpOAuthResultError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpOAuthResultError";
  }
}

class McpOAuthTimeoutError extends Error {
  constructor() {
    super(OAUTH_TIMEOUT_ERROR);
    this.name = "McpOAuthTimeoutError";
  }
}

export const DEFAULT_MCP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const LEGACY_AUTH_TIMEOUT_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_POLL_RETRY_DELAY_MS = 10_000;
const MCP_OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const FINAL_RESULT_CONSUMPTION_TIMEOUT_MS = 5_000;
const GITHUB_MCP_HOST = "api.githubcopilot.com";
const AZURE_DEVOPS_HOSTS = ["dev.azure.com", "visualstudio.com"] as const;

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
  let hostname: string;
  try {
    hostname = new URL(serverUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }

  if (hostname === GITHUB_MCP_HOST) {
    return "github";
  }

  if (AZURE_DEVOPS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return "azure-devops";
  }

  return undefined;
}

export function resolveMcpOAuthTimeoutMs(
  provider: McpOAuthProvider | undefined,
  configuredTimeoutMs?: number,
): number {
  if (
    configuredTimeoutMs !== undefined &&
    Number.isFinite(configuredTimeoutMs) &&
    configuredTimeoutMs > 0
  ) {
    return configuredTimeoutMs;
  }

  return provider ? DEFAULT_MCP_AUTH_TIMEOUT_MS : LEGACY_AUTH_TIMEOUT_MS;
}

async function getPortalAccessToken(): Promise<string> {
  const accessToken = await IdentityServerAuthService.getInstance().getAccessToken();
  if (!accessToken) {
    throw new Error("Sign in to YakShaver before connecting an MCP server");
  }
  return accessToken;
}

function getMcpOAuthRedirectUri(serverId: string): string {
  const protocol =
    config.azure()?.customProtocol ||
    (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");
  return `${protocol}://oauth/callback?serverId=${encodeURIComponent(serverId)}`;
}

async function getOAuthResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (isRecord(data)) {
      const message =
        (typeof data.error === "string" && data.error) ||
        (typeof data.detail === "string" && data.detail);
      if (message) {
        return `${fallback}: ${message} (Status: ${response.status})`;
      }
    }
  } catch {
    // Fall back to the status-only message when the backend does not return JSON.
  }

  return `${fallback} (Status: ${response.status})`;
}

function getOAuthRequestSignal(parentSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(MCP_OAUTH_REQUEST_TIMEOUT_MS);
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
}

function createOAuthNetworkError(action: string, cause: unknown): Error {
  const errorName = isRecord(cause) && typeof cause.name === "string" ? cause.name : undefined;
  if (errorName === "TimeoutError") {
    return new Error(`Timed out while trying to ${action}. Try again.`, { cause });
  }
  if (errorName === "AbortError") {
    return new Error(`Cancelled while trying to ${action}.`, { cause });
  }

  return new Error(
    `Failed to ${action}. Ensure the YakShaver backend is running and its SSL certificate is trusted.`,
    { cause },
  );
}

async function requestMcpOAuthStart(
  serverUrl: string,
  serverId: string,
  options: McpOAuthStartRequestOptions = {},
): Promise<unknown> {
  const url = new URL(`${config.portalApiUrl()}/mcp/auth/start`);
  url.searchParams.set("serverUrl", serverUrl);
  url.searchParams.set("redirectUri", getMcpOAuthRedirectUri(serverId));
  if (options.provider) {
    url.searchParams.set("provider", options.provider);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal: getOAuthRequestSignal(),
      headers,
    });
  } catch (error) {
    throw createOAuthNetworkError("start MCP OAuth", error);
  }

  if (!response.ok) {
    throw new Error(await getOAuthResponseError(response, "Failed to start MCP OAuth"));
  }

  return await response.json();
}

async function startRecoverableOAuth(
  serverUrl: string,
  serverId: string,
  provider: McpOAuthProvider,
  accessToken: string,
): Promise<McpOAuthSession> {
  const data = await requestMcpOAuthStart(serverUrl, serverId, { provider, accessToken });
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

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal: getOAuthRequestSignal(signal),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error("MCP OAuth result polling was cancelled", { cause: error });
    }
    throw createOAuthNetworkError("retrieve the MCP OAuth result", error);
  }

  if (response.status === 202) {
    return undefined;
  }

  if (response.status === 404) {
    throw new McpOAuthResultError(
      "MCP OAuth session expired or was already used. Reconnect the MCP server.",
      response.status,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new McpOAuthResultError(
      "Your YakShaver sign-in expired. Sign in again before reconnecting.",
      response.status,
    );
  }

  if (!response.ok) {
    throw new McpOAuthResultError(
      await getOAuthResponseError(response, "Failed to retrieve MCP OAuth result"),
      response.status,
    );
  }

  const data: unknown = await response.json();
  return parseOAuthTokens(data);
}

async function consumeRecoverableOAuthResultAfterDeepLink(
  serverUrl: string,
  state: string,
): Promise<void> {
  try {
    const accessToken = await getPortalAccessToken();
    await getRecoverableOAuthResult(
      serverUrl,
      state,
      accessToken,
      AbortSignal.timeout(FINAL_RESULT_CONSUMPTION_TIMEOUT_MS),
    );
  } catch (error) {
    // The Deep Link already persisted the tokens. This request only consumes the backend copy.
    console.warn(
      "[McpOAuth] Failed to consume the backend OAuth result after Deep Link completion:",
      error,
    );
  }
}

function isTerminalOAuthResultError(error: unknown): boolean {
  return (
    (error instanceof McpOAuthResultError &&
      (error.status === 401 || error.status === 403 || error.status === 404)) ||
    error instanceof McpOAuthTimeoutError
  );
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
  onResultConsumed: () => void,
): Promise<OAuthTokens> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  let pendingTokens: OAuthTokens | undefined;

  while (Date.now() < deadline && !signal.aborted) {
    try {
      if (!pendingTokens) {
        const currentAccessToken = await getPortalAccessToken();
        pendingTokens = await getRecoverableOAuthResult(
          serverUrl,
          state,
          currentAccessToken,
          signal,
        );
        consecutiveFailures = 0;
        if (pendingTokens) {
          onResultConsumed();
        }
      }

      if (pendingTokens) {
        const completed = await tokenStorage.completeOAuthAsync(serverId, pendingTokens);
        if (completed) {
          return pendingTokens;
        }

        const previouslyCompletedTokens = await tokenStorage.getTokensAsync(serverId);
        if (previouslyCompletedTokens) {
          return previouslyCompletedTokens;
        }

        throw new Error("MCP OAuth completion did not leave tokens in storage");
      }
    } catch (error) {
      if (signal.aborted || isTerminalOAuthResultError(error)) {
        throw error;
      }

      consecutiveFailures += 1;
      const retryDelayMs = Math.min(
        pollIntervalMs * 2 ** (consecutiveFailures - 1),
        MAX_POLL_RETRY_DELAY_MS,
      );
      console.warn(
        `[McpOAuth] OAuth result recovery failed transiently; retrying in ${retryDelayMs}ms:`,
        error,
      );
      const remainingMs = Math.max(0, deadline - Date.now());
      await delayUntilNextPoll(Math.min(retryDelayMs, remainingMs), signal);
      continue;
    }

    await delayUntilNextPoll(pollIntervalMs, signal);
  }

  throw new McpOAuthTimeoutError();
}

/**
 * Gets the authorization URL from the .NET backend for an MCP server.
 */
async function getAuthUrlFromBackend(serverUrl: string, serverId: string): Promise<string> {
  const data = await requestMcpOAuthStart(serverUrl, serverId);
  if (!isRecord(data)) {
    throw new Error("MCP OAuth start response was invalid");
  }
  return getRequiredString(data, "authorizationUrl", "MCP OAuth start response");
}

/**
 * Waits for tokens to be available for a given server ID using an event-driven approach.
 */
async function waitForTokens(
  tokenStorage: McpOAuthTokenStorage,
  serverId: string,
  timeoutMs: number,
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
      reject(new McpOAuthTimeoutError());
    }, timeoutMs);

    // Close the gap between the initial lookup and listener registration.
    void resolveStoredTokens().catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * De-duplicates concurrent OAuth authorizations by serverId. Without this, a
 * single Reauthorize (which clears the token) races the health-check and
 * list-tools paths — each rediscovers "no token" and opens its own browser tab,
 * so the user gets several authorization pages for one action (#982).
 */
const inFlightAuthorizations = new Map<string, Promise<OAuthTokens>>();

async function authorizeWithBackendOnce(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  options: McpOAuthAuthorizeOptions,
): Promise<OAuthTokens> {
  const provider = options.provider ?? inferMcpOAuthProvider(serverUrl);
  const timeoutMs = resolveMcpOAuthTimeoutMs(provider, options.timeoutMs);

  if (!provider) {
    const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
    await shell.openExternal(authUrl);
    return waitForTokens(tokenStorage, serverId, timeoutMs);
  }

  const accessToken = await getPortalAccessToken();
  // Recovery state is intentionally in-memory; restarting the app requires restarting OAuth.
  const session = await startRecoverableOAuth(serverUrl, serverId, provider, accessToken);
  const pollingAbortController = new AbortController();
  const deepLinkAbortController = new AbortController();
  let backendResultConsumed = false;
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
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollingAbortController.signal,
    () => {
      backendResultConsumed = true;
    },
  );
  const deepLinkCompletion = deepLinkTokens.then((tokens) => ({
    source: "deep-link" as const,
    tokens,
  }));
  const pollingCompletion = polledTokens.then(
    (tokens) => ({ source: "polling" as const, tokens }),
    (error: unknown) => ({ source: "polling-error" as const, error }),
  );
  // `Promise.race` below is the only consumer of `deepLinkCompletion`. When `shell.openExternal`
  // rejects (no handler registered for the URL) we never reach it, yet `finally` still aborts the
  // Deep Link wait — rejecting an unobserved promise. Node treats that as an unhandled rejection
  // and would take down the Electron main process instead of surfacing the launch failure.
  deepLinkCompletion.catch(() => undefined);

  try {
    await shell.openExternal(session.authorizationUrl);
    const completion = await Promise.race([deepLinkCompletion, pollingCompletion]);
    if (completion.source === "polling-error") {
      console.warn(
        "[McpOAuth] Result polling failed; continuing to wait for the Deep Link callback:",
        completion.error,
      );
      pollingAbortController.abort();
      try {
        return await deepLinkTokens;
      } catch (deepLinkError) {
        if (isTerminalOAuthResultError(completion.error)) {
          throw completion.error;
        }
        throw deepLinkError;
      }
    }
    if (completion.source === "deep-link") {
      pollingAbortController.abort();
      if (!backendResultConsumed) {
        void consumeRecoverableOAuthResultAfterDeepLink(serverUrl, session.state);
      }
    }
    return completion.tokens;
  } finally {
    pollingAbortController.abort();
    deepLinkAbortController.abort();
  }
}

export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  options: McpOAuthAuthorizeOptions = {},
): Promise<OAuthTokens> {
  const existing = inFlightAuthorizations.get(serverId);
  if (existing) return existing;

  const authorization = authorizeWithBackendOnce(tokenStorage, serverUrl, serverId, options);

  inFlightAuthorizations.set(serverId, authorization);
  try {
    return await authorization;
  } finally {
    if (inFlightAuthorizations.get(serverId) === authorization) {
      inFlightAuthorizations.delete(serverId);
    }
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
