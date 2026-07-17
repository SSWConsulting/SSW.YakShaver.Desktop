import { beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "../../../shared/mcp/preset-servers";
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
