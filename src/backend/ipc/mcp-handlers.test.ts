import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "./channels";

// Capture the handlers registered via ipcMain.handle so we can invoke them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { McpIPCHandlers } from "./mcp-handlers";

type ManagerMock = {
  getMcpClientAsync: ReturnType<typeof vi.fn>;
  checkServerHealthAsync: ReturnType<typeof vi.fn>;
};

function makeManager(overrides: Partial<ManagerMock> = {}): ManagerMock {
  return {
    getMcpClientAsync: vi.fn(),
    checkServerHealthAsync: vi.fn(),
    ...overrides,
  };
}

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({} as unknown, ...args);
}

describe("MCP_LIST_SERVER_TOOLS handler (#982)", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("throws the classified health error when the client can't be built", async () => {
    const manager = makeManager({
      getMcpClientAsync: vi.fn().mockResolvedValue(null),
      checkServerHealthAsync: vi.fn().mockResolvedValue({
        isHealthy: false,
        isChecking: false,
        authFailed: true,
        error: "HTTP 401: token expired or revoked",
      }),
    });
    new McpIPCHandlers(manager as unknown as ConstructorParameters<typeof McpIPCHandlers>[0]);

    await expect(invoke(IPC_CHANNELS.MCP_LIST_SERVER_TOOLS, "srv-1")).rejects.toThrow(
      "HTTP 401: token expired or revoked",
    );
  });

  it("falls back to a generic message when health has no error string", async () => {
    const manager = makeManager({
      getMcpClientAsync: vi.fn().mockResolvedValue(null),
      checkServerHealthAsync: vi.fn().mockResolvedValue({ isHealthy: false, isChecking: false }),
    });
    new McpIPCHandlers(manager as unknown as ConstructorParameters<typeof McpIPCHandlers>[0]);

    await expect(invoke(IPC_CHANNELS.MCP_LIST_SERVER_TOOLS, "srv-1")).rejects.toThrow(
      /Unable to connect/i,
    );
  });
});
