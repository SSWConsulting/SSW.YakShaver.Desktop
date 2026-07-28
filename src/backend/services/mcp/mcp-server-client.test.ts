import { beforeEach, describe, expect, it, vi } from "vitest";

// This is the headline reproduction for #836: when an MCP token refresh fails
// *transiently* (network blip / backend 5xx), the stored refresh token must be
// PRESERVED so the connection recovers automatically. Only a backend-rejected
// (invalid_grant) refresh token should be cleared and force a manual reconnect.

const mocks = vi.hoisted(() => ({
  mockStorage: {
    getTokensAsync: vi.fn(),
    isTokenExpired: vi.fn(),
    saveTokensAsync: vi.fn(),
    clearTokensAsync: vi.fn(),
  },
  refreshWithRetry: vi.fn(),
  authorize: vi.fn(),
  createMcpClient: vi.fn(),
}));

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../../config/env", () => ({
  config: {
    portalApiUrl: () => "https://api.test/api",
    isDev: () => true,
    azure: () => undefined,
  },
}));
vi.mock("@ai-sdk/mcp", () => ({
  experimental_createMCPClient: mocks.createMcpClient,
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: vi.fn() }));
vi.mock("../storage/mcp-oauth-token-storage", () => ({
  McpOAuthTokenStorage: {
    TOKENS_UPDATED_EVENT: "tokens-updated",
    getInstance: () => mocks.mockStorage,
  },
}));
// Keep the real error class + classifier; only stub the network-touching functions.
vi.mock("./mcp-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-oauth")>();
  return {
    ...actual,
    refreshTokenWithBackendWithRetry: mocks.refreshWithRetry,
    authorizeWithBackend: mocks.authorize,
  };
});

import { McpTokenRefreshError } from "./mcp-oauth";
import { MCPServerClient } from "./mcp-server-client";
import type { MCPServerConfig } from "./types";

const SERVER_CONFIG: MCPServerConfig = {
  id: "github",
  name: "GitHub",
  transport: "streamableHttp",
  url: "https://mcp.github.example/",
  enabled: true,
};

const EXPIRED_TOKENS = {
  access_token: "old-access",
  refresh_token: "valid-refresh",
  expires_in: 3600,
  storedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MCP_AUTH_TIMEOUT_MS;
  mocks.mockStorage.getTokensAsync.mockResolvedValue(EXPIRED_TOKENS);
  mocks.mockStorage.isTokenExpired.mockReturnValue(true);
  mocks.createMcpClient.mockResolvedValue({});
});

describe("MCPServerClient.createClientAsync — token refresh failure handling (#836)", () => {
  it("PRESERVES the refresh token on a transient refresh failure (no unexpected sign-out)", async () => {
    mocks.refreshWithRetry.mockRejectedValue(
      new McpTokenRefreshError("backend 503", { status: 503, isInvalidGrant: false }),
    );

    await expect(MCPServerClient.createClientAsync(SERVER_CONFIG)).rejects.toBeInstanceOf(
      McpTokenRefreshError,
    );

    // The bug was that ANY refresh failure cleared the token. After the fix a transient
    // failure must leave the stored credential untouched so the next attempt recovers.
    expect(mocks.mockStorage.clearTokensAsync).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });

  it("CLEARS the refresh token only when the backend rejects it as invalid_grant", async () => {
    mocks.refreshWithRetry.mockRejectedValue(
      new McpTokenRefreshError("invalid_grant", { status: 400, isInvalidGrant: true }),
    );
    // After a genuine rejection the flow falls through to interactive re-auth; stub it as a
    // no-op that yields no tokens so the client builds with unauthenticated headers.
    mocks.authorize.mockResolvedValue(undefined);
    mocks.mockStorage.getTokensAsync
      .mockResolvedValueOnce(EXPIRED_TOKENS) // initial read
      .mockResolvedValue(undefined); // after clear + after re-auth

    await MCPServerClient.createClientAsync(SERVER_CONFIG);

    expect(mocks.mockStorage.clearTokensAsync).toHaveBeenCalledWith("github");
  });

  it("refreshes and proceeds normally when the refresh succeeds", async () => {
    const fresh = {
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_in: 3600,
    };
    mocks.refreshWithRetry.mockResolvedValue(fresh);
    mocks.mockStorage.getTokensAsync
      .mockResolvedValueOnce(EXPIRED_TOKENS) // initial read
      .mockResolvedValue({ ...fresh, storedAt: 2 }); // after save

    await MCPServerClient.createClientAsync(SERVER_CONFIG);

    expect(mocks.mockStorage.saveTokensAsync).toHaveBeenCalledWith("github", fresh);
    expect(mocks.mockStorage.clearTokensAsync).not.toHaveBeenCalled();
    expect(mocks.createMcpClient).toHaveBeenCalled();
  });
});

describe("MCPServerClient.createClientAsync — recoverable OAuth (#771)", () => {
  it("uses the backend's five-minute OAuth result lifetime by default", async () => {
    mocks.mockStorage.getTokensAsync
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ ...EXPIRED_TOKENS, access_token: "fresh-access" });
    mocks.authorize.mockResolvedValue(undefined);

    await MCPServerClient.createClientAsync(SERVER_CONFIG);

    expect(mocks.authorize).toHaveBeenCalledWith(
      mocks.mockStorage,
      SERVER_CONFIG.url,
      SERVER_CONFIG.id,
      5 * 60 * 1000,
    );
  });

  it("surfaces an OAuth recovery error instead of trying an unauthenticated connection", async () => {
    mocks.mockStorage.getTokensAsync.mockResolvedValue(undefined);
    mocks.authorize.mockRejectedValue(
      new Error("MCP OAuth session expired or was already used. Reconnect the MCP server."),
    );

    await expect(MCPServerClient.createClientAsync(SERVER_CONFIG)).rejects.toThrow(
      "Reconnect the MCP server",
    );

    expect(mocks.createMcpClient).not.toHaveBeenCalled();
  });
});
