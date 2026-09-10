import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../ipc/channels";
import { MCPServerManager } from "../services/mcp/mcp-server-manager";
import type { MCPServerConfig } from "../services/mcp/types";
import { claimLaunchNonce } from "../services/portal/claim-launch-nonce";
import { McpOAuthTokenStorage } from "../services/storage/mcp-oauth-token-storage";
import { handleProtocolUrl } from "./protocol-router";

vi.mock("../services/mcp/mcp-server-manager", () => ({
  MCPServerManager: {
    getServerConfigByIdAsync: vi.fn(),
  },
}));

vi.mock("../services/storage/mcp-oauth-token-storage", () => ({
  McpOAuthTokenStorage: {
    getInstance: vi.fn(),
  },
}));

// Only the network call is faked. isNonceShaped stays real, so these exercise the validation the
// router actually relies on rather than a copy of it.
vi.mock("../services/portal/claim-launch-nonce", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/portal/claim-launch-nonce")>()),
  claimLaunchNonce: vi.fn().mockResolvedValue(true),
}));

describe("protocol-router", () => {
  const mockWindow = (send: ReturnType<typeof vi.fn>): BrowserWindow =>
    ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    }) as unknown as BrowserWindow;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends IPC error when OAuth callback params are missing", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    await handleProtocolUrl(
      "yakshaver-desktop://oauth/callback?access_token=token&serverId=server-1",
      window,
    );

    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.PROTOCOL_ERROR,
      expect.stringContaining("missing required parameters"),
    );
  });

  it("sends IPC error for unhandled routes", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    const handled = await handleProtocolUrl("yakshaver-desktop://unknown/path", window);

    expect(handled).toBe(false);
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.PROTOCOL_ERROR,
      "Unhandled protocol route: /unknown/path",
    );
  });

  it("handles /auth route successfully (no error)", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    const handled = await handleProtocolUrl("yakshaver-desktop://auth", window);

    expect(handled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("handles /launch route successfully (no error)", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    const handled = await handleProtocolUrl("yakshaver-desktop://launch", window);

    expect(handled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("forwards the attempt id so a stale tab cannot cancel a newer authorization", async () => {
    const notifyAuthFailed = vi.fn();
    vi.mocked(McpOAuthTokenStorage.getInstance).mockReturnValue({
      notifyAuthFailed,
    } as unknown as McpOAuthTokenStorage);

    await handleProtocolUrl(
      "yakshaver-desktop://oauth/callback?serverId=server-1&error=authorization_failed&attemptId=attempt-7",
      mockWindow(vi.fn()),
    );

    expect(notifyAuthFailed).toHaveBeenCalledWith("server-1", "attempt-7");
  });

  // A callback from before the attempt id shipped must still fail fast rather than hang.
  it("still reports failure when the callback carries no attempt id", async () => {
    const notifyAuthFailed = vi.fn();
    vi.mocked(McpOAuthTokenStorage.getInstance).mockReturnValue({
      notifyAuthFailed,
    } as unknown as McpOAuthTokenStorage);

    await handleProtocolUrl(
      "yakshaver-desktop://oauth/callback?serverId=server-1&error=authorization_failed",
      mockWindow(vi.fn()),
    );

    expect(notifyAuthFailed).toHaveBeenCalledWith("server-1", null);
  });

  it("stores tokens for valid OAuth callback", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    const completeOAuthAsync = vi.fn().mockResolvedValue(true);
    const getInstance = vi.mocked(McpOAuthTokenStorage.getInstance);
    getInstance.mockReturnValue({ completeOAuthAsync } as unknown as McpOAuthTokenStorage);

    const getServerConfigByIdAsync = vi.mocked(MCPServerManager.getServerConfigByIdAsync);
    getServerConfigByIdAsync.mockResolvedValue({
      id: "server-1",
      name: "Test Server",
      transport: "inMemory",
      inMemoryServerId: "server-1",
    } satisfies MCPServerConfig);

    await handleProtocolUrl(
      "yakshaver-desktop://oauth/callback?access_token=token&refresh_token=refresh&serverId=server-1",
      window,
    );

    expect(send).not.toHaveBeenCalled();
    expect(completeOAuthAsync).toHaveBeenCalledWith("server-1", {
      access_token: "token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: undefined,
      scope: undefined,
    });
  });

  it("logs when a late OAuth callback is ignored after polling already completed", async () => {
    const completeOAuthAsync = vi.fn().mockResolvedValue(false);
    vi.mocked(McpOAuthTokenStorage.getInstance).mockReturnValue({
      completeOAuthAsync,
    } as unknown as McpOAuthTokenStorage);
    vi.mocked(MCPServerManager.getServerConfigByIdAsync).mockResolvedValue({
      id: "server-1",
      name: "Test Server",
      transport: "inMemory",
      inMemoryServerId: "server-1",
    } satisfies MCPServerConfig);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await handleProtocolUrl(
      "yakshaver-desktop://oauth/callback?access_token=late&refresh_token=late-refresh&serverId=server-1",
    );

    expect(info).toHaveBeenCalledWith(expect.stringContaining("server-1"));
  });

  // The nonce is what lets the portal stop guessing whether this app opened
  // (SSWConsulting/SSW.YakShaver#3956). It must be claimed when present and never block the launch
  // when it is not.
  describe("/launch", () => {
    const NONCE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    it("claims a well-formed nonce", async () => {
      const handled = await handleProtocolUrl(`yakshaver-desktop://launch?nonce=${NONCE}`);

      expect(handled).toBe(true);
      expect(claimLaunchNonce).toHaveBeenCalledWith(NONCE);
    });

    it("still launches when no nonce is present, so an older portal keeps working", async () => {
      const send = vi.fn();

      const handled = await handleProtocolUrl("yakshaver-desktop://launch", mockWindow(send));

      expect(handled).toBe(true);
      expect(claimLaunchNonce).not.toHaveBeenCalled();
      // Absent is normal, not an error. Reporting it would put a scary banner in front of a user
      // whose app just opened correctly.
      expect(send).not.toHaveBeenCalled();
    });

    it.each([
      "not-a-uuid",
      "../../etc/passwd",
      "",
    ])("ignores the malformed nonce %s without blocking the launch", async (nonce) => {
      const handled = await handleProtocolUrl(
        `yakshaver-desktop://launch?nonce=${encodeURIComponent(nonce)}`,
      );

      expect(handled).toBe(true);
      expect(claimLaunchNonce).not.toHaveBeenCalled();
    });
  });
});
