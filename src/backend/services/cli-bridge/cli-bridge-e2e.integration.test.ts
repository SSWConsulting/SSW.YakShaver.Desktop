import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliBridgeTokenFileSchema, REDACTED } from "../../../shared/cli-bridge/protocol";
import type { MCPServerConfig } from "../mcp/types";
import type { BridgeServices } from "./bridge-router";

/**
 * End-to-end coverage of the ASSEMBLED bridge path that no other suite exercises:
 *
 *   HTTP server (real fetch) -> bearer-token auth -> JSON body reader/parser
 *     -> routeRequest -> REAL MCPServerManager (in-memory McpStorage)
 *
 * cli-bridge-server.test.ts drives the real HTTP/auth layer but with fully MOCKED
 * services; bridge-router.integration.test.ts drives the real manager but calls
 * routeRequest() directly, bypassing HTTP/auth/body-parse. This test wires the
 * real CliBridgeServer to a real-manager-backed BridgeServices and proves a valid
 * POST body survives the wire AND that secrets are redacted in the HTTP response
 * while the real value is persisted underneath.
 */

const { TEST_USER_DATA } = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  return { TEST_USER_DATA: path.join(os.tmpdir(), `yakshaver-bridge-e2e-${process.pid}`) };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue(TEST_USER_DATA),
    getVersion: vi.fn().mockReturnValue("0.0.0-test"),
    setLoginItemSettings: vi.fn(),
  },
}));

// In-memory stand-in for the secure McpStorage (no Electron safeStorage / DB).
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

// The manager's client/transport layer is never needed for config CRUD.
vi.mock("./mcp-server-client", () => ({ MCPServerClient: class {} }));

import { MCPServerManager } from "../mcp/mcp-server-manager";
import { CliBridgeServer } from "./cli-bridge-server";

/** Same MCP surface createDefaultServices() builds, backed by the real manager. */
async function realServices(): Promise<BridgeServices> {
  const manager = await MCPServerManager.getInstanceAsync();
  return {
    mcp: {
      listAvailableServers: () => manager.listAvailableServers(),
      addServerAsync: (config) => manager.addServerAsync(config),
      updateServerAsync: (serverId, config) => manager.updateServerAsync(serverId, config),
      removeServerAsync: (serverId) => manager.removeServerAsync(serverId),
      getServerByIdAsync: (serverId) => MCPServerManager.getServerConfigByIdAsync(serverId),
    },
    llm: { getLLMConfig: async () => null, storeLLMConfig: async () => {} },
    settings: {
      getSettingsAsync: async () => ({ toolApprovalMode: "ask" }) as never,
      updateSettingsAsync: async () => {},
    },
    tools: {
      listTools: async () => [],
      callTool: async () => ({ ok: false, error: "not used in this test" }),
    },
  };
}

async function readToken(): Promise<{ port: number; token: string }> {
  const filePath = join(TEST_USER_DATA, "yakshaver-tokens", "cli-bridge.json");
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return CliBridgeTokenFileSchema.parse(raw);
}

describe("CLI bridge end-to-end (HTTP + auth + body + real manager)", () => {
  let server: CliBridgeServer;

  beforeEach(async () => {
    memStore.configs = [];
    // biome-ignore lint/suspicious/noExplicitAny: reset private statics for isolation
    (MCPServerManager as any).instance = undefined;
    // biome-ignore lint/suspicious/noExplicitAny: reset private statics for isolation
    (MCPServerManager as any).internalServerConfigs = [];
    // @ts-expect-error reset private static for isolation
    CliBridgeServer.instance = null;
    server = CliBridgeServer.getInstance(await realServices());
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(TEST_USER_DATA, { recursive: true, force: true });
    memStore.configs = [];
  });

  it("POSTs a valid body over HTTP, redacts the secret in the response, persists the real value, then lists it", async () => {
    const { port, token } = await readToken();
    const base = `http://127.0.0.1:${port}`;
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // POST /mcp/servers with a secret header — through real readJsonBody + JSON.parse.
    const addRes = await fetch(`${base}/mcp/servers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Round Trip",
        transport: "streamableHttp",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer top-secret" },
      }),
    });
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json();
    expect(addBody.ok).toBe(true);
    const id = addBody.data.id as string;
    expect(id).toBeTruthy();

    // Secret redacted on the wire, real value persisted underneath.
    expect(addBody.data.headers.Authorization).toBe(REDACTED);
    const storedHeaders = (memStore.configs[0] as { headers?: Record<string, string> }).headers;
    expect(storedHeaders?.Authorization).toBe("Bearer top-secret");

    // GET /mcp/servers over HTTP lists it with the secret still redacted.
    const listRes = await fetch(`${base}/mcp/servers`, { headers: auth });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.ok).toBe(true);
    expect((listBody.data as MCPServerConfig[]).some((s) => s.id === id)).toBe(true);
    expect(JSON.stringify(listBody.data)).not.toContain("top-secret");

    // DELETE over HTTP removes it for real.
    const delRes = await fetch(`${base}/mcp/servers/${id}`, { method: "DELETE", headers: auth });
    expect(delRes.status).toBe(200);
    expect(memStore.configs.find((s) => s.id === id)).toBeUndefined();
  });

  it("rejects an unauthenticated POST without ever reaching the manager", async () => {
    const { port } = await readToken();
    const res = await fetch(`http://127.0.0.1:${port}/mcp/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope", transport: "stdio", command: "node" }),
    });
    expect(res.status).toBe(401);
    expect(memStore.configs).toHaveLength(0);
  });
});
