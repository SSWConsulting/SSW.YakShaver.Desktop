import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPServerConfig } from "./types";

const storageState = vi.hoisted(() => ({ configs: [] as MCPServerConfig[] }));

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

  it("rejects renaming a server to an existing name", async () => {
    const manager = await MCPServerManager.getInstanceAsync();
    const first = await manager.addServerAsync(createServer("first"));
    const second = await manager.addServerAsync(createServer("second"));

    await expect(
      manager.updateServerAsync(second.id, { ...second, name: first.name.toUpperCase() }),
    ).rejects.toThrow("Server with name 'FIRST' already exists");
    expect(storageState.configs.map((config) => config.name)).toEqual(["first", "second"]);
  });
});
