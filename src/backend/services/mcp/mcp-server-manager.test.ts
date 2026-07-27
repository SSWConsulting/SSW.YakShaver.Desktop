import { beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "../../../shared/mcp/preset-servers";
import type { MCPServerConfig } from "./types";

const storageState = vi.hoisted(() => ({ configs: [] as MCPServerConfig[] }));
const mocks = vi.hoisted(() => ({
  createClientAsync: vi.fn(),
  clearTokensAsync: vi.fn(),
  authorizeWithBackend: vi.fn(),
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

vi.mock("../storage/mcp-oauth-token-storage", () => ({
  McpOAuthTokenStorage: {
    getInstance: () => ({
      clearTokensAsync: mocks.clearTokensAsync,
    }),
  },
}));

vi.mock("./mcp-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-oauth")>();
  return {
    ...actual,
    authorizeWithBackend: mocks.authorizeWithBackend,
  };
});

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
    mocks.clearTokensAsync.mockReset();
    mocks.authorizeWithBackend.mockReset();
    // Health checks now read/write the shared client cache + in-flight creation
    // map; clear both so cases don't leak state into one another (#982).
    (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.clear();
    (
      MCPServerManager as unknown as { clientCreationPromises: Map<string, unknown> }
    ).clientCreationPromises.clear();
  });

  it("reports authFailed when the tool probe returns 401", async () => {
    mocks.createClientAsync.mockResolvedValue({
      probeHealthAsync: vi.fn().mockResolvedValue({
        healthy: false,
        toolCount: 0,
        authFailed: true,
      }),
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
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
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
    });

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");
    expect(result.isHealthy).toBe(false);
    expect(result.authFailed).toBeFalsy();
  });

  it("reauthorize clears tokens and reruns OAuth without changing enabled", async () => {
    mocks.authorizeWithBackend.mockResolvedValue({ access_token: "new-token" });

    const manager = await MCPServerManager.getInstanceAsync();
    await manager.reauthorizeServerAsync("srv-1");

    expect(mocks.clearTokensAsync).toHaveBeenCalledWith("srv-1");
    expect(mocks.authorizeWithBackend).toHaveBeenCalled();

    const cfg = (await manager.listAvailableServers()).find((s) => s.id === "srv-1");
    expect(cfg?.enabled).toBe(true);
  });

  it("reauthorize disconnects and evicts a previously cached client", async () => {
    mocks.authorizeWithBackend.mockResolvedValue({ access_token: "new-token" });
    const disconnectAsync = vi.fn().mockResolvedValue(undefined);

    const manager = await MCPServerManager.getInstanceAsync();
    (
      MCPServerManager as unknown as {
        mcpClients: Map<string, { disconnectAsync: () => Promise<void> }>;
      }
    ).mcpClients.set("srv-1", { disconnectAsync });

    await manager.reauthorizeServerAsync("srv-1");

    expect(disconnectAsync).toHaveBeenCalled();
    expect(
      (
        MCPServerManager as unknown as {
          mcpClients: Map<string, unknown>;
        }
      ).mcpClients.has("srv-1"),
    ).toBe(false);
  });

  it("reuses the cached client for the probe instead of creating a new one (#982)", async () => {
    const probeHealthAsync = vi
      .fn()
      .mockResolvedValue({ healthy: true, toolCount: 3, authFailed: false });
    const cached = { probeHealthAsync, disconnectAsync: vi.fn() };
    (
      MCPServerManager as unknown as {
        mcpClients: Map<string, unknown>;
      }
    ).mcpClients.set("srv-1", cached);

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");

    expect(result.isHealthy).toBe(true);
    // Probed the cached client; never spawned a fresh connection.
    expect(probeHealthAsync).toHaveBeenCalledTimes(1);
    expect(mocks.createClientAsync).not.toHaveBeenCalled();
    // The healthy cached client is left in place, untouched.
    expect(cached.disconnectAsync).not.toHaveBeenCalled();
    expect(
      (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.get("srv-1"),
    ).toBe(cached);
  });

  it("closes a freshly-created probe client when the probe fails (#982)", async () => {
    const disconnectAsync = vi.fn().mockResolvedValue(undefined);
    mocks.createClientAsync.mockResolvedValue({
      probeHealthAsync: vi
        .fn()
        .mockResolvedValue({ healthy: false, toolCount: 0, authFailed: false }),
      disconnectAsync,
    });

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");

    expect(result.isHealthy).toBe(false);
    // The failed, never-cached probe client is closed, not leaked.
    expect(disconnectAsync).toHaveBeenCalledTimes(1);
    expect(
      (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.has("srv-1"),
    ).toBe(false);
  });

  it("evicts a cached client that fails a non-auth probe (#982)", async () => {
    const disconnectAsync = vi.fn().mockResolvedValue(undefined);
    const cached = {
      probeHealthAsync: vi
        .fn()
        .mockResolvedValue({ healthy: false, toolCount: 0, authFailed: false }),
      disconnectAsync,
    };
    (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.set(
      "srv-1",
      cached,
    );

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");

    expect(result.isHealthy).toBe(false);
    // A dead cached client is evicted + closed so it isn't handed to the orchestrator.
    expect(disconnectAsync).toHaveBeenCalledTimes(1);
    expect(
      (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.has("srv-1"),
    ).toBe(false);
  });

  it("keeps a cached client on an auth (401) probe failure — reauth owns eviction (#982)", async () => {
    const disconnectAsync = vi.fn().mockResolvedValue(undefined);
    const cached = {
      probeHealthAsync: vi
        .fn()
        .mockResolvedValue({ healthy: false, toolCount: 0, authFailed: true }),
      disconnectAsync,
    };
    (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.set(
      "srv-1",
      cached,
    );

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");

    expect(result.isHealthy).toBe(false);
    expect(result.authFailed).toBe(true);
    // Left in place: the connection is still usable once re-credentialed.
    expect(disconnectAsync).not.toHaveBeenCalled();
    expect(
      (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.get("srv-1"),
    ).toBe(cached);
  });

  it("deduplicates concurrent client creation — no leaked connection/process (#982)", async () => {
    // Two overlapping health checks with an empty cache must share ONE client
    // creation, not each build a client and race to overwrite the cache.
    let resolveCreate: (client: unknown) => void = () => {};
    const created = {
      probeHealthAsync: vi
        .fn()
        .mockResolvedValue({ healthy: true, toolCount: 1, authFailed: false }),
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
    };
    mocks.createClientAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const manager = await MCPServerManager.getInstanceAsync();
    const first = manager.checkServerHealthAsync("srv-1");
    const second = manager.checkServerHealthAsync("srv-1");
    // Let both calls drain their pre-creation awaits (config resolution, etc.)
    // and reach the shared in-flight creation before it resolves.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    resolveCreate(created);
    const [a, b] = await Promise.all([first, second]);

    expect(a.isHealthy).toBe(true);
    expect(b.isHealthy).toBe(true);
    // The client was built exactly once and cached; nothing leaked.
    expect(mocks.createClientAsync).toHaveBeenCalledTimes(1);
    expect(created.disconnectAsync).not.toHaveBeenCalled();
    expect(
      (MCPServerManager as unknown as { mcpClients: Map<string, unknown> }).mcpClients.get("srv-1"),
    ).toBe(created);
  });

  it("surfaces a non-empty error string when the probe fails with 401", async () => {
    mocks.createClientAsync.mockResolvedValue({
      probeHealthAsync: vi.fn().mockResolvedValue({
        healthy: false,
        toolCount: 0,
        authFailed: true,
        error: "HTTP 401 Unauthorized",
      }),
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
    });

    const manager = await MCPServerManager.getInstanceAsync();
    const result = await manager.checkServerHealthAsync("srv-1");
    expect(result.isHealthy).toBe(false);
    expect(result.authFailed).toBe(true);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toHaveLength(0);
  });
});
