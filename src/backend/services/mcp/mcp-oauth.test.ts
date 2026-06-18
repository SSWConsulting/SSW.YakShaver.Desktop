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

describe("refreshTokenWithBackend — failure classification (#836)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the new tokens on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, TOKENS)));

    await expect(refreshTokenWithBackend("https://srv", "rt")).resolves.toEqual(TOKENS);
  });

  it("flags a 400 invalid_grant as a genuinely invalid refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(400, { error: "invalid_grant", error_description: "Token expired" }),
        ),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(true);
    expect(isInvalidRefreshTokenError(error)).toBe(true);
  });

  it("flags a 401 carrying a recognised invalid_grant-family code as a dead refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid_token" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(true);
    expect(isInvalidRefreshTokenError(error)).toBe(true);
  });

  // Regression guards for the review finding: a bare 400/401 status must NOT, on its own,
  // classify the refresh token as dead — only a recognised invalid_grant-family code may (#836).

  it("classifies a 401 WITHOUT a grant-death code (e.g. 'unauthorized') as transient — token preserved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" })));

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
    expect(isInvalidRefreshTokenError(error)).toBe(false);
  });

  it("classifies a 401 with no parseable body as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error("no body");
        },
        text: async () => "",
      } as unknown as Response),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
  });

  it("classifies a 400 request-validation error ('invalid_request') as transient — not a dead grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_request" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
    expect(isInvalidRefreshTokenError(error)).toBe(false);
  });

  it("classifies a 400 with no error code (gateway/WAF wrapping) as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, {})));

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error.isInvalidGrant).toBe(false);
  });

  it("classifies a 5xx as TRANSIENT (refresh token must be preserved)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { error: "backend_unavailable" })),
    );

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(error).toBeInstanceOf(McpTokenRefreshError);
    expect(error.isInvalidGrant).toBe(false);
    expect(error.isTransient).toBe(true);
    expect(isInvalidRefreshTokenError(error)).toBe(false);
  });

  it("classifies a 429 (rate limit) as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: "rate_limited" })));

    const error = await refreshTokenWithBackend("https://srv", "rt").catch((e) => e);

    expect(isInvalidRefreshTokenError(error)).toBe(false);
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_grant" }));
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
