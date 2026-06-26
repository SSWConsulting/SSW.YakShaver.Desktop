import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPServerConfig } from "../mcp/types";

/**
 * Integration test for the MCP transport-switch path that drives the bridge's
 * `mergeMcpPatch` through the REAL `MCPServerManager.updateServerAsync` (with
 * `McpStorage` mocked to an in-memory store), rather than a mocked manager.
 *
 * It guards the invariant the bridge's design comment promises: after an
 * HTTP->stdio (or stdio->HTTP) switch, no stale fields of the OLD transport
 * (e.g. a secret-bearing `headers`/`url`, or `command`/`args`/`env`) survive in
 * the persisted config. A previous regression was masked because the unit tests
 * mocked `updateServerAsync` and only asserted on the value PASSED to the mock,
 * never the manager's own second merge against the re-fetched stored config.
 */

// In-memory backing store the mocked McpStorage reads/writes.
let store: MCPServerConfig[] = [];

vi.mock("../storage/mcp-storage", () => ({
  McpStorage: {
    getInstance: () => ({
      getMcpServerConfigsAsync: async () => store.map((s) => ({ ...s })),
      storeMcpServers: async (servers: MCPServerConfig[]) => {
        store = servers.map((s) => ({ ...s }));
      },
    }),
  },
}));

// Avoid pulling preset servers into the merge for this focused test.
vi.mock("../../../shared/mcp/preset-servers", () => ({
  PRESET_MCP_SERVERS: [],
}));

import { MCPServerManager } from "../mcp/mcp-server-manager";
import { routeRequest } from "./bridge-router";

function makeServices() {
  return {
    mcp: {
      listAvailableServers: async () => {
        const m = await MCPServerManager.getInstanceAsync();
        return m.listAvailableServers();
      },
      addServerAsync: async (config: MCPServerConfig) => {
        const m = await MCPServerManager.getInstanceAsync();
        return m.addServerAsync(config);
      },
      updateServerAsync: async (serverId: string, config: MCPServerConfig) => {
        const m = await MCPServerManager.getInstanceAsync();
        return m.updateServerAsync(serverId, config);
      },
      removeServerAsync: async (serverId: string) => {
        const m = await MCPServerManager.getInstanceAsync();
        return m.removeServerAsync(serverId);
      },
      getServerByIdAsync: async (serverId: string) =>
        MCPServerManager.getServerConfigByIdAsync(serverId),
    },
    llm: {
      getLLMConfig: async () => null,
      storeLLMConfig: async () => {},
    },
    settings: {
      getSettingsAsync: async () => ({}) as never,
      updateSettingsAsync: async () => {},
    },
    // These transport-switch tests only hit MCP routes; the tools front-door is never invoked.
    tools: {
      listTools: async () => [],
      callTool: async () => ({ ok: true, result: "" }) as never,
    },
  };
}

describe("bridge -> real MCPServerManager transport switch", () => {
  beforeEach(() => {
    store = [];
  });

  it("HTTP->stdio strips stale url/headers in the PERSISTED config (real manager merge)", async () => {
    store = [
      {
        id: "srv-1",
        name: "Test HTTP",
        transport: "streamableHttp",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer super-secret" },
        enabled: true,
      },
    ];

    const res = await routeRequest(makeServices(), {
      method: "PUT",
      path: "/mcp/servers/srv-1",
      body: { transport: "stdio", command: "node" },
    });
    expect(res.status).toBe(200);

    const persisted = store.find((s) => s.id === "srv-1") as unknown as Record<string, unknown>;
    expect(persisted.transport).toBe("stdio");
    expect(persisted.command).toBe("node");
    // The real second merge must NOT re-introduce the stale HTTP fields.
    expect(persisted.url).toBeUndefined();
    expect(persisted.headers).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain("super-secret");
  });

  it("stdio->HTTP strips stale command/args/env in the PERSISTED config", async () => {
    store = [
      {
        id: "srv-2",
        name: "Test stdio",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "secret-token" },
        enabled: true,
      },
    ];

    const res = await routeRequest(makeServices(), {
      method: "PUT",
      path: "/mcp/servers/srv-2",
      body: { transport: "streamableHttp", url: "https://new.example.com/mcp" },
    });
    expect(res.status).toBe(200);

    const persisted = store.find((s) => s.id === "srv-2") as unknown as Record<string, unknown>;
    expect(persisted.transport).toBe("streamableHttp");
    expect(persisted.url).toBe("https://new.example.com/mcp");
    expect(persisted.command).toBeUndefined();
    expect(persisted.args).toBeUndefined();
    expect(persisted.env).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain("secret-token");
  });
});
