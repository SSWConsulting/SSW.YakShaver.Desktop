import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockStorage = {
    getTokens: vi.fn(),
    storeTokens: vi.fn(),
    clearTokens: vi.fn(),
  };

  const mockOpenIdClient = {
    refreshTokenGrant: vi.fn(),
  };

  return {
    mockStorage,
    mockOpenIdClient,
  };
});

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock("../storage/identity-server-token-storage", () => ({
  IdentityServerTokenStorage: {
    getInstance: vi.fn(() => mocks.mockStorage),
  },
}));

import {
  decodeIdentityServerAccessToken,
  IdentityServerAuthService,
  getUserInfoFromIdentityServerAccessToken,
} from "./identity-server-auth";
import type { TokenData } from "./types";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));

  return `${header}.${encodedPayload}.signature`;
}

function createTokenData(overrides: Partial<TokenData> = {}): TokenData {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 5 * 60 * 1000,
    scope: ["openid", "profile"],
    ...overrides,
  };
}

function createRefreshResponse(accessToken: string, refreshToken = "next-refresh-token") {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    expiresIn: () => 3600,
    scope: "openid profile",
  };
}

describe("IdentityServerAuthService", () => {
  let service: IdentityServerAuthService;

  beforeEach(() => {
    vi.clearAllMocks();

    // @ts-expect-error - Reset singleton for test isolation
    IdentityServerAuthService.instance = null;

    service = IdentityServerAuthService.getInstance();

    // @ts-expect-error - Configure private state for focused unit tests
    service.clientConfiguration = {};
    // @ts-expect-error - Configure private state for focused unit tests
    service.openIdClientPromise = Promise.resolve(mocks.mockOpenIdClient);
  });

  it("returns the cached access token when it is outside the expiry buffer", async () => {
    const tokenData = createTokenData({ expiresAt: Date.now() + 5 * 60 * 1000 });

    // @ts-expect-error - Configure private state for focused unit tests
    service.currentTokens = tokenData;

    await expect(service.getAccessToken()).resolves.toBe("access-token");
    expect(mocks.mockOpenIdClient.refreshTokenGrant).not.toHaveBeenCalled();
  });

  it("refreshes and returns a new access token when the current token is within the expiry buffer", async () => {
    const tokenData = createTokenData({ expiresAt: Date.now() + 30 * 1000 });
    mocks.mockOpenIdClient.refreshTokenGrant.mockResolvedValue(
      createRefreshResponse("refreshed-access-token"),
    );

    // @ts-expect-error - Configure private state for focused unit tests
    service.currentTokens = tokenData;

    await expect(service.getAccessToken()).resolves.toBe("refreshed-access-token");
    expect(mocks.mockOpenIdClient.refreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(mocks.mockStorage.storeTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "refreshed-access-token" }),
    );
  });

  it("shares a single in-flight refresh across concurrent callers", async () => {
    const tokenData = createTokenData({ expiresAt: Date.now() + 30 * 1000 });
    let resolveRefresh: ((value: ReturnType<typeof createRefreshResponse>) => void) | undefined;

    mocks.mockOpenIdClient.refreshTokenGrant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    // @ts-expect-error - Configure private state for focused unit tests
    service.currentTokens = tokenData;

    const firstTokenPromise = service.getAccessToken();
    const secondTokenPromise = service.getAccessToken();
    const isAuthenticatedPromise = service.isAuthenticated();

    await vi.waitFor(() => {
      expect(mocks.mockOpenIdClient.refreshTokenGrant).toHaveBeenCalledTimes(1);
    });

    resolveRefresh?.(createRefreshResponse("shared-refreshed-token"));

    await expect(firstTokenPromise).resolves.toBe("shared-refreshed-token");
    await expect(secondTokenPromise).resolves.toBe("shared-refreshed-token");
    await expect(isAuthenticatedPromise).resolves.toBe(true);
    expect(mocks.mockOpenIdClient.refreshTokenGrant).toHaveBeenCalledTimes(1);
  });

  it("returns null and clears stored tokens when refresh fails", async () => {
    const tokenData = createTokenData({ expiresAt: Date.now() + 30 * 1000 });
    mocks.mockOpenIdClient.refreshTokenGrant.mockRejectedValue(new Error("refresh failed"));

    // @ts-expect-error - Configure private state for focused unit tests
    service.currentTokens = tokenData;

    await expect(service.getAccessToken()).resolves.toBeNull();
    await expect(service.isAuthenticated()).resolves.toBe(false);
    expect(mocks.mockStorage.clearTokens).toHaveBeenCalledTimes(1);
  });
});

describe("decodeIdentityServerAccessToken", () => {
  it("decodes standard profile claims from the access token", () => {
    const token = createJwt({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
      idp: "Microsoft",
    });

    expect(decodeIdentityServerAccessToken(token)).toEqual({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
      name: undefined,
      preferred_username: undefined,
    });
  });

  it("returns null for an invalid token", () => {
    expect(decodeIdentityServerAccessToken("not-a-jwt")).toBeNull();
  });
});

describe("getUserInfoFromIdentityServerAccessToken", () => {
  it("builds user info from given and family name claims", () => {
    const token = createJwt({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
    });

    expect(getUserInfoFromIdentityServerAccessToken(token)).toEqual({
      id: "00000000-1111-2222-3333-444444444444",
      name: "Bob Northwind",
      email: "bob.northwind@example.test",
    });
  });

  it("falls back to preferred_username when name claims are missing", () => {
    const token = createJwt({
      sub: "user-123",
      preferred_username: "alex@example.com",
    });

    expect(getUserInfoFromIdentityServerAccessToken(token)).toEqual({
      id: "user-123",
      name: "alex@example.com",
      email: "alex@example.com",
    });
  });
});
