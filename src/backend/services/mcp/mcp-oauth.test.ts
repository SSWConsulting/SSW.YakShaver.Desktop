import { shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../../config/env", () => ({
  config: {
    portalApiUrl: () => "https://api.test/api",
    isDev: () => true,
    azure: () => undefined,
  },
}));
// Keep the real storage chain (electron safeStorage / app) out of these unit tests.
vi.mock("../storage/mcp-oauth-token-storage", () => ({
  McpOAuthTokenStorage: {
    TOKENS_UPDATED_EVENT: "tokens-updated",
    getInstance: vi.fn(),
  },
}));

import {
  authorizeWithBackend,
  extractUpstreamOAuthErrorCode,
  isInvalidRefreshTokenError,
  McpTokenRefreshError,
  refreshTokenWithBackend,
  refreshTokenWithBackendWithRetry,
} from "./mcp-oauth";

const TOKENS = { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Reproduces the REAL `/mcp/auth/refresh` failure body. The backend never forwards the
 * upstream OAuth error verbatim — it returns HTTP 400 with `{ error: ex.Message }` where the
 * message is `"Token exchange failed with status <UpstreamStatus>: <raw upstream body>"`
 * (SSWConsulting/SSW.YakShaver: McpOAuthService.RequestAccessTokenAsync + McpEndpoints.RefreshMcpToken).
 */
function backendRefreshError(upstreamStatus: string, upstreamBody: unknown): Response {
  const body = typeof upstreamBody === "string" ? upstreamBody : JSON.stringify(upstreamBody);
  return jsonResponse(400, {
    error: `Token exchange failed with status ${upstreamStatus}: ${body}`,
  });
}

describe("extractUpstreamOAuthErrorCode — pulling the upstream code out of the backend wrapper", () => {
  it("extracts invalid_grant from the real wrapped JSON body", () => {
    expect(
      extractUpstreamOAuthErrorCode(
        'Token exchange failed with status BadRequest: {"error":"invalid_grant","error_description":"Token is not active"}',
      ),
    ).toBe("invalid_grant");
  });

  it("extracts the code regardless of field order (error after error_description)", () => {
    expect(
      extractUpstreamOAuthErrorCode(
        'Token exchange failed with status BadRequest: {"error_description":"nope","error":"invalid_client"}',
      ),
    ).toBe("invalid_client");
  });

  it("extracts from a form-encoded upstream body", () => {
    expect(
      extractUpstreamOAuthErrorCode(
        "Token exchange failed with status BadRequest: error=invalid_grant&error_description=expired",
      ),
    ).toBe("invalid_grant");
  });

  it("passes through a cleanly-forwarded bare code (forward-compatible)", () => {
    expect(extractUpstreamOAuthErrorCode("invalid_grant")).toBe("invalid_grant");
  });

  it("returns undefined for a non-OAuth backend error (e.g. missing server config)", () => {
    expect(
      extractUpstreamOAuthErrorCode("No MCP server config found for host github.com"),
    ).toBeUndefined();
    expect(extractUpstreamOAuthErrorCode(undefined)).toBeUndefined();
  });
});

describe("refreshTokenWithBackend — failure classification (#836)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the new tokens on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, TOKENS)));

    await expect(refreshTokenWithBackend("https://srv", "rt")).resolves.toEqual(TOKENS);
  });

  it("flags the REAL backend-wrapped invalid_grant as a genuinely invalid refresh token", async () => {
    // The actual contract: backend returns 400 { error: "Token exchange failed with status
    // BadRequest: {\"error\":\"invalid_grant\",...}" } — NOT a clean { error: "invalid_grant" }.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        backendRefreshError("BadRequest", {
          error: "invalid_grant",
          error_description: "Token is not active",
        }),
      ),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(true);
    expect(isInvalidRefreshTokenError(error)).toBe(true);
  });

  it("flags a cleanly-forwarded invalid_grant too (forward-compatible if the backend is fixed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_grant" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(true);
    expect(isInvalidRefreshTokenError(error)).toBe(true);
  });

  // Regression guards: only an upstream `invalid_grant` may clear the token. The backend wraps
  // EVERYTHING as a 400, so status alone proves nothing — anything that isn't positively
  // invalid_grant must be transient so we never sign the user out over a non-token fault (#836).

  it("classifies a wrapped invalid_client (client/registration fault) as transient — token preserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(backendRefreshError("BadRequest", { error: "invalid_client" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
    expect(isInvalidRefreshTokenError(error)).toBe(false);
  });

  it("classifies a missing-server-config backend error as transient (not a dead token)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(400, { error: "No MCP server config found for host github.com" }),
        ),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
    expect(isInvalidRefreshTokenError(error)).toBe(false);
  });

  it("classifies a wrapped upstream 5xx as transient (refresh token must be preserved)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(backendRefreshError("InternalServerError", "upstream temporarily down")),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(false);
    expect(error.isTransient).toBe(true);
  });

  it("classifies a wrapped invalid_request as transient — not a dead grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(backendRefreshError("BadRequest", { error: "invalid_request" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
  });

  it("classifies a 400 with no error code (gateway/WAF wrapping) as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, {})));

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
  });

  it("classifies a 400 with no parseable body as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => {
          throw new Error("no body");
        },
        text: async () => "",
      } as unknown as Response),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
  });

  it("classifies a network/SSL failure as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(false);
  });
});

describe("refreshTokenWithBackendWithRetry — bounded retry on transient failures (#836)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a transient failure and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, TOKENS));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(refreshTokenWithBackendWithRetry("https://srv", "rt", { sleep })).resolves.toEqual(
      TOKENS,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on persistent transient failures, surfacing a transient error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { error: "unavailable" }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await refreshTokenWithBackendWithRetry("https://srv", "rt", {
      retries: 3,
      sleep,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a genuine invalid_grant — fails fast so the caller can clear the dead token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(backendRefreshError("BadRequest", { error: "invalid_grant" }));
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await refreshTokenWithBackendWithRetry("https://srv", "rt", { sleep }).catch(
      (e) => e,
    );

    expect(isInvalidRefreshTokenError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("authorizeWithBackend — concurrent de-duplication (#982)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens only ONE browser tab when the same server is authorized concurrently", async () => {
    const openExternal = vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    openExternal.mockClear();
    // getAuthUrlFromBackend does a fetch → return an auth URL.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { authorizationUrl: "https://auth.test/go" })),
    );
    // waitForTokens resolves immediately when the store already yields a token.
    const tokenStorage = {
      getTokensAsync: vi.fn().mockResolvedValue(TOKENS),
    } as unknown as import("../storage/mcp-oauth-token-storage").McpOAuthTokenStorage;

    // Fire two authorizations for the SAME serverId at once.
    const [a, b] = await Promise.all([
      authorizeWithBackend(tokenStorage, "https://srv", "srv-1"),
      authorizeWithBackend(tokenStorage, "https://srv", "srv-1"),
    ]);

    expect(a).toEqual(TOKENS);
    expect(b).toEqual(TOKENS);
    // The dedup means only one browser tab / one backend auth-URL fetch happened.
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh authorization after the previous one settles", async () => {
    const openExternal = vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    openExternal.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { authorizationUrl: "https://auth.test/go" })),
    );
    const tokenStorage = {
      getTokensAsync: vi.fn().mockResolvedValue(TOKENS),
    } as unknown as import("../storage/mcp-oauth-token-storage").McpOAuthTokenStorage;

    await authorizeWithBackend(tokenStorage, "https://srv", "srv-1");
    await authorizeWithBackend(tokenStorage, "https://srv", "srv-1");

    // Sequential (not concurrent) calls each open their own tab — the entry is
    // cleared once settled, so a later re-auth is not swallowed.
    expect(openExternal).toHaveBeenCalledTimes(2);
  });
});
