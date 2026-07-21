import { beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "../../../shared/mcp/preset-servers";
import type { MCPServerConfig } from "./types";

const storageState = vi.hoisted(() => ({ configs: [] as MCPServerConfig[] }));
const mocks = vi.hoisted(() => ({
  createClientAsync: vi.fn(),
}));

vi.mock("../storage/mcp-storage", () => ({
  McpStorage: {
    getInstance: () => ({
      getMcpServerConfigsAsync: async () => structuredClone(storageState.configs),
      storeMcpServers: async (configs: MCPServerConfig[]) => {
        storageState.configs = structuredClone(configs);
      },
    }),
  },
}));

vi.mock("./mcp-server-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-server-client")>();
  return {
    ...actual,
    MCPServerClient: {
      ...actual.MCPServerClient,
      createClientAsync: mocks.createClientAsync,
    },
  };
});

import { MCPServerManager } from "./mcp-server-manager";

function createServer(name: string): MCPServerConfig {
  return {
    id: "",
    name,
    transport: "stdio",
    command: "npx",
  };
}

describe("MCPServerManager server name uniqueness", () => {
  beforeEach(() => {
    storageState.configs = [];
  });

  it("rejects a duplicate name when adding a server", async () => {
    const manager = await MCPServerManager.getInstanceAsync();
    await manager.addServerAsync(createServer("playwright"));

    await expect(manager.addServerAsync(createServer("Playwright"))).rejects.toThrow(
      "Server with name 'Playwright' already exists",
    );
    expect(storageState.configs).toHaveLength(1);
  });

  it.each([
    "GitHub",
    "github",
    "Jira",
  ])("rejects a custom server named like the unconnected %s preset", async (name) => {
    const manager = await MCPServerManager.getInstanceAsync();

    await expect(manager.addServerAsync(createServer(name))).rejects.toThrow(
      `Server with name '${name}' already exists`,
    );
    expect(storageState.configs).toHaveLength(0);
  });

  it("allows persisting an unconnected preset using its current id", async () => {
    const manager = await MCPServerManager.getInstanceAsync();

    await manager.updateServerAsync(PRESET_SERVER_IDS.GITHUB, {
      ...GITHUB_PRESET_CONFIG,
      enabled: true,
    });

    expect(storageState.configs).toEqual([{ ...GITHUB_PRESET_CONFIG, enabled: true }]);
  });

  it("rejects renaming a server to an existing name", async () => {
    const manager = await MCPServerManager.getInstanceAsync();
    const first = await manager.addServerAsync(createServer("first"));
    const second = await manager.addServerAsync(createServer("second"));

    await expect(
      manager.updateServerAsync(second.id, { ...second, name: first.name.toUpperCase() }),
    ).rejects.toThrow("Server with name 'FIRST' already exists");
    expect(storageState.configs.map((config) => config.name)).toEqual(["first", "second"]);
  });

  it("rejects renaming a custom server to an unconnected preset name", async () => {
    const manager = await MCPServerManager.getInstanceAsync();
    const server = await manager.addServerAsync(createServer("custom"));

    await expect(
      manager.updateServerAsync(server.id, { ...server, name: "GITHUB" }),
    ).rejects.toThrow("Server with name 'GITHUB' already exists");
    expect(storageState.configs.map((config) => config.name)).toEqual(["custom"]);
  });
});

describe("MCPServerManager.checkServerHealthAsync auth classification", () => {
  beforeEach(() => {
    storageState.configs = [
      {
        id: "srv-1",
        name: "auth-test-server",
        transport: "streamableHttp",
        url: "https://mcp.example.com/",
        enabled: true,
      },
    ];
    mocks.createClientAsync.mockReset();
  });

  it("reports authFailed when the tool probe returns 401", async () => {
    mocks.createClientAsync.mockResolvedValue({
      probeHealthAsync: vi.fn().mockResolvedValue({
        healthy: false,
        toolCount: 0,
        authFailed: true,
      }),
    });

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");
    expect(result.isHealthy).toBe(false);
    expect(result.authFailed).toBe(true);
  });

  it("does not set authFailed for a non-401 failure", async () => {
    mocks.createClientAsync.mockResolvedValue({
      probeHealthAsync: vi.fn().mockResolvedValue({
        healthy: false,
        toolCount: 0,
        authFailed: false,
      }),
    });

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");
    expect(result.isHealthy).toBe(false);
    expect(result.authFailed).toBeFalsy();
  });
});
