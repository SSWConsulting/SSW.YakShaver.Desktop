import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "../../../shared/cli-bridge/protocol";
import type { MCPServerConfig } from "../mcp/types";
import { type BridgeServices, routeRequest } from "./bridge-router";

/**
 * Integration coverage for the CLI bridge against the REAL MCPServerManager
 * (not the hand-written mocks the other suites use). The PR's unit tests prove
 * the router and HTTP layer in isolation, but the one path no test exercised was
 * the actual wiring in createDefaultServices() -> MCPServerManager singleton:
 * the merge-with-built-ins logic, real persistence, real redaction shapes, and
 * the built-in immutability invariant.
 *
 * We back the manager with an in-memory McpStorage (so there is no Electron
 * safeStorage / DB dependency) but otherwise let the genuine manager methods run,
 * then drive them through routeRequest exactly as the live bridge does.
 */

// In-memory stand-in for the secure McpStorage. The real manager only needs
// getMcpServerConfigsAsync + storeMcpServers from it.
const memStore: { configs: MCPServerConfig[] } = { configs: [] };

vi.mock("../storage/mcp-storage", () => ({
  McpStorage: {
    getInstance: () => ({
      getMcpServerConfigsAsync: async () => structuredClone(memStore.configs),
      storeMcpServers: async (servers: MCPServerConfig[]) => {
        memStore.configs = structuredClone(servers);
      },
      hasMcpServersAsync: async () => memStore.configs.length > 0,
    }),
  },
}));

// The manager's client layer is never needed for config CRUD; stub the transport
// pieces so importing it doesn't drag in real MCP clients.
vi.mock("./mcp-server-client", () => ({
  MCPServerClient: class {},
}));

import { MCPServerManager } from "../mcp/mcp-server-manager";

/**
 * Builds the SAME service surface createDefaultServices() builds, but inlined so
 * the test does not need Electron. Every method calls the real manager.
 */
async function realMcpServices(): Promise<BridgeServices["mcp"]> {
  const manager = await MCPServerManager.getInstanceAsync();
  return {
    listAvailableServers: () => manager.listAvailableServers(),
    addServerAsync: (config) => manager.addServerAsync(config),
    updateServerAsync: (serverId, config) => manager.updateServerAsync(serverId, config),
    removeServerAsync: (serverId) => manager.removeServerAsync(serverId),
    getServerByIdAsync: (serverId) => MCPServerManager.getServerConfigByIdAsync(serverId),
  };
}

async function makeServices(): Promise<BridgeServices> {
  return {
    mcp: await realMcpServices(),
    llm: {
      getLLMConfig: async () => null,
      storeLLMConfig: async () => {},
    },
    settings: {
      getSettingsAsync: async () => ({ toolApprovalMode: "ask" }) as never,
      updateSettingsAsync: async () => {},
    },
  };
}

/** Seed a built-in server into the manager's internal (non-stored) config list. */
function seedBuiltin(): void {
  // biome-ignore lint/suspicious/noExplicitAny: writing a private static for test isolation
  (MCPServerManager as any).internalServerConfigs = [
    {
      id: "builtin-1",
      name: "Built In",
      transport: "inMemory",
      enabled: true,
      builtin: true,
      inMemoryServerId: "builtin-1",
    },
  ];
}

describe("CLI bridge ↔ real MCPServerManager wiring", () => {
  beforeEach(() => {
    memStore.configs = [];
    // biome-ignore lint/suspicious/noExplicitAny: reset private statics for isolation
    (MCPServerManager as any).instance = undefined;
    // biome-ignore lint/suspicious/noExplicitAny: reset private statics for isolation
    (MCPServerManager as any).internalServerConfigs = [];
  });

  afterEach(() => {
    memStore.configs = [];
  });

  it("add -> list -> get -> update -> remove round-trips through the real manager", async () => {
    const services = await makeServices();

    // POST /mcp/servers (real addServerAsync persists into the in-memory store)
    const addRes = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers",
      body: {
        name: "Round Trip",
        transport: "streamableHttp",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer top-secret" },
      },
    });
    expect(addRes.status).toBe(201);
    if (!addRes.body.ok) throw new Error("expected ok");
    const created = addRes.body.data as MCPServerConfig & {
      headers?: Record<string, string>;
    };
    const id = created.id;
    expect(id).toBeTruthy();
    // Secret redacted even though the real manager stored the real value.
    expect(created.headers?.Authorization).toBe(REDACTED);
    const storedHeaders = (memStore.configs[0] as { headers?: Record<string, string> }).headers;
    expect(storedHeaders?.Authorization).toBe("Bearer top-secret");

    // GET /mcp/servers lists it (merged set) with the secret still redacted.
    const listRes = await routeRequest(services, { method: "GET", path: "/mcp/servers" });
    if (!listRes.body.ok) throw new Error("expected ok");
    const list = listRes.body.data as MCPServerConfig[];
    expect(list.some((s) => s.id === id)).toBe(true);
    expect(JSON.stringify(list)).not.toContain("top-secret");

    // PUT /mcp/servers/:id renames via the real merge.
    const putRes = await routeRequest(services, {
      method: "PUT",
      path: `/mcp/servers/${id}`,
      body: { name: "Renamed", transport: "streamableHttp", url: "https://new.example.com/mcp" },
    });
    expect(putRes.status).toBe(200);
    expect(memStore.configs.find((s) => s.id === id)?.name).toBe("Renamed");

    // DELETE /mcp/servers/:id removes it for real.
    const delRes = await routeRequest(services, { method: "DELETE", path: `/mcp/servers/${id}` });
    expect(delRes.status).toBe(200);
    if (!delRes.body.ok) throw new Error("expected ok");
    expect(delRes.body.data).toEqual({ id, removed: true });
    expect(memStore.configs.find((s) => s.id === id)).toBeUndefined();
  });

  it("enable toggle persists and the real list reflects it", async () => {
    const services = await makeServices();
    const addRes = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers",
      body: { name: "Toggle Me", transport: "stdio", command: "node" },
    });
    if (!addRes.body.ok) throw new Error("expected ok");
    const id = (addRes.body.data as MCPServerConfig).id;

    const offRes = await routeRequest(services, {
      method: "POST",
      path: `/mcp/servers/${id}/enabled`,
      body: { enabled: false },
    });
    expect(offRes.status).toBe(200);
    expect(memStore.configs.find((s) => s.id === id)?.enabled).toBe(false);

    const listRes = await routeRequest(services, { method: "GET", path: "/mcp/servers" });
    if (!listRes.body.ok) throw new Error("expected ok");
    const server = (listRes.body.data as MCPServerConfig[]).find((s) => s.id === id);
    expect(server?.enabled).toBe(false);
  });

  it("refuses to enable/disable a built-in server (409) and never persists a phantom row", async () => {
    seedBuiltin();
    const services = await makeServices();

    // The built-in IS visible in the merged list...
    const listRes = await routeRequest(services, { method: "GET", path: "/mcp/servers" });
    if (!listRes.body.ok) throw new Error("expected ok");
    expect((listRes.body.data as MCPServerConfig[]).some((s) => s.id === "builtin-1")).toBe(true);

    // ...but enabling/disabling it is rejected instead of silently no-op'ing.
    const res = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers/builtin-1/enabled",
      body: { enabled: false },
    });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    // No phantom stored row was written for the built-in.
    expect(memStore.configs.find((s) => s.id === "builtin-1")).toBeUndefined();
  });

  it("refuses to PUT or DELETE a built-in server (409)", async () => {
    seedBuiltin();
    const services = await makeServices();

    const putRes = await routeRequest(services, {
      method: "PUT",
      path: "/mcp/servers/builtin-1",
      body: { name: "Hijacked", transport: "streamableHttp", url: "https://evil.example.com/mcp" },
    });
    expect(putRes.status).toBe(409);
    expect(memStore.configs.find((s) => s.id === "builtin-1")).toBeUndefined();

    const delRes = await routeRequest(services, {
      method: "DELETE",
      path: "/mcp/servers/builtin-1",
    });
    expect(delRes.status).toBe(409);
  });
});
