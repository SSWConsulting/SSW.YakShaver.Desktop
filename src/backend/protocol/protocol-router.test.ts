import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../ipc/channels";
import { MCPServerManager } from "../services/mcp/mcp-server-manager";
import type { MCPServerConfig } from "../services/mcp/types";
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

  it("stores tokens for valid OAuth callback", async () => {
    const send = vi.fn();
    const window = mockWindow(send);

    const saveTokensAsync = vi.fn();
    const getInstance = vi.mocked(McpOAuthTokenStorage.getInstance);
    getInstance.mockReturnValue({ saveTokensAsync } as unknown as McpOAuthTokenStorage);

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
    expect(saveTokensAsync).toHaveBeenCalledWith("server-1", {
      access_token: "token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: undefined,
      scope: undefined,
    });
  });
});
