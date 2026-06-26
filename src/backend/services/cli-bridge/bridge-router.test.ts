import { beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "../../../shared/cli-bridge/protocol";
import type { MCPServerConfig } from "../mcp/types";
import { type BridgeServices, routeRequest } from "./bridge-router";

function makeServices(overrides: Partial<BridgeServices> = {}): BridgeServices {
  const httpServer: MCPServerConfig = {
    id: "srv-1",
    name: "Test HTTP",
    transport: "streamableHttp",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer super-secret" },
    enabled: true,
  };

  return {
    mcp: {
      listAvailableServers: vi.fn().mockResolvedValue([httpServer]),
      addServerAsync: vi.fn().mockImplementation(async (c: MCPServerConfig) => ({
        ...c,
        id: "new-id",
      })),
      updateServerAsync: vi.fn().mockResolvedValue(undefined),
      removeServerAsync: vi.fn().mockResolvedValue(undefined),
      getServerByIdAsync: vi.fn().mockResolvedValue(httpServer),
      ...overrides.mcp,
    },
    llm: {
      getLLMConfig: vi.fn().mockResolvedValue({
        version: 2,
        languageModel: { provider: "openai", model: "gpt-4", apiKey: "sk-secret-123" },
        transcriptionModel: null,
        providerApiKeys: { openai: "sk-secret-123" },
      }),
      storeLLMConfig: vi.fn().mockResolvedValue(undefined),
      ...overrides.llm,
    },
    settings: {
      getSettingsAsync: vi.fn().mockResolvedValue({
        toolApprovalMode: "ask",
        openAtLogin: false,
        hotkeys: { startRecording: "PrintScreen" },
      }),
      updateSettingsAsync: vi.fn().mockResolvedValue(undefined),
      ...overrides.settings,
    },
    tools: {
      listTools: vi.fn().mockResolvedValue([]),
      callTool: vi.fn().mockResolvedValue({ ok: false, error: "not used in this test" }),
      ...overrides.tools,
    },
  };
}

describe("routeRequest - MCP", () => {
  let services: BridgeServices;
  beforeEach(() => {
    services = makeServices();
  });

  it("GET /mcp/servers lists servers with secrets redacted", async () => {
    const res = await routeRequest(services, { method: "GET", path: "/mcp/servers" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (!res.body.ok) throw new Error("expected ok");
    const servers = res.body.data as MCPServerConfig[];
    expect(servers).toHaveLength(1);
    // header secret must be redacted, never echoed in full
    const headers = (servers[0] as { headers?: Record<string, string> }).headers;
    expect(headers?.Authorization).toBe(REDACTED);
    expect(JSON.stringify(servers)).not.toContain("super-secret");
  });

  it("POST /mcp/servers adds a valid stdio server", async () => {
    const body = {
      name: "My Server",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    };
    const res = await routeRequest(services, { method: "POST", path: "/mcp/servers", body });
    expect(res.status).toBe(201);
    expect(services.mcp.addServerAsync).toHaveBeenCalledOnce();
    if (!res.body.ok) throw new Error("expected ok");
    expect((res.body.data as MCPServerConfig).name).toBe("My Server");
  });

  it("POST /mcp/servers rejects invalid config via zod", async () => {
    const res = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers",
      body: { name: "X", transport: "stdio" }, // missing command
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(services.mcp.addServerAsync).not.toHaveBeenCalled();
  });

  it("POST /mcp/servers rejects http server with a bad url", async () => {
    const res = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers",
      body: { name: "X", transport: "streamableHttp", url: "not-a-url" },
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("PUT /mcp/servers/:id updates and merges with existing", async () => {
    const body = {
      name: "Renamed",
      transport: "streamableHttp",
      url: "https://new.example.com/mcp",
    };
    const res = await routeRequest(services, {
      method: "PUT",
      path: "/mcp/servers/srv-1",
      body,
    });
    expect(res.status).toBe(200);
    expect(services.mcp.updateServerAsync).toHaveBeenCalledWith(
      "srv-1",
      expect.objectContaining({ id: "srv-1", name: "Renamed" }),
    );
  });

  it("PUT /mcp/servers/:id merges ONLY provided fields onto existing", async () => {
    // Patch only the url; the existing name + headers must be preserved.
    const res = await routeRequest(services, {
      method: "PUT",
      path: "/mcp/servers/srv-1",
      body: { url: "https://patched.example.com/mcp" },
    });
    expect(res.status).toBe(200);
    expect(services.mcp.updateServerAsync).toHaveBeenCalledWith(
      "srv-1",
      expect.objectContaining({
        id: "srv-1",
        name: "Test HTTP", // preserved from existing
        transport: "streamableHttp", // preserved
        url: "https://patched.example.com/mcp", // updated
      }),
    );
  });

  it("PUT /mcp/servers/:id 404s when the server does not exist", async () => {
    const svc = makeServices({
      mcp: {
        ...makeServices().mcp,
        getServerByIdAsync: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await routeRequest(svc, {
      method: "PUT",
      path: "/mcp/servers/nope",
      body: { name: "X" },
    });
    expect(res.status).toBe(404);
    expect(svc.mcp.updateServerAsync).not.toHaveBeenCalled();
  });

  it("PUT /mcp/servers/:id rejects unknown fields via the patch schema", async () => {
    const res = await routeRequest(services, {
      method: "PUT",
      path: "/mcp/servers/srv-1",
      body: { bogus: "field" },
    });
    expect(res.status).toBe(400);
    expect(services.mcp.updateServerAsync).not.toHaveBeenCalled();
  });

  it("DELETE /mcp/servers/:id removes the server", async () => {
    const res = await routeRequest(services, { method: "DELETE", path: "/mcp/servers/srv-1" });
    expect(res.status).toBe(200);
    expect(services.mcp.removeServerAsync).toHaveBeenCalledWith("srv-1");
    if (!res.body.ok) throw new Error("expected ok");
    expect(res.body.data).toEqual({ id: "srv-1", removed: true });
  });

  it("POST /mcp/servers/:id/enabled toggles enabled state", async () => {
    const res = await routeRequest(services, {
      method: "POST",
      path: "/mcp/servers/srv-1/enabled",
      body: { enabled: false },
    });
    expect(res.status).toBe(200);
    expect(services.mcp.updateServerAsync).toHaveBeenCalledWith(
      "srv-1",
      expect.objectContaining({ id: "srv-1", enabled: false }),
    );
  });

  it("POST /mcp/servers/:id/enabled 404s on unknown server", async () => {
    const svc = makeServices({
      mcp: {
        ...makeServices().mcp,
        getServerByIdAsync: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await routeRequest(svc, {
      method: "POST",
      path: "/mcp/servers/does-not-exist/enabled",
      body: { enabled: true },
    });
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it("decodes url-encoded ids", async () => {
    await routeRequest(services, {
      method: "DELETE",
      path: `/mcp/servers/${encodeURIComponent("id with spaces")}`,
    });
    expect(services.mcp.removeServerAsync).toHaveBeenCalledWith("id with spaces");
  });

  it("returns 405 for an unsupported method", async () => {
    const res = await routeRequest(services, { method: "PATCH", path: "/mcp/servers" });
    expect(res.status).toBe(405);
  });

  describe("built-in server immutability", () => {
    const builtin: MCPServerConfig = {
      id: "builtin-1",
      name: "Built In",
      transport: "inMemory",
      enabled: true,
      builtin: true,
    } as MCPServerConfig;

    function builtinServices() {
      return makeServices({
        mcp: {
          ...makeServices().mcp,
          getServerByIdAsync: vi.fn().mockResolvedValue(builtin),
        },
      });
    }

    it("rejects enabling/disabling a built-in server with 409 and does not persist", async () => {
      const svc = builtinServices();
      const res = await routeRequest(svc, {
        method: "POST",
        path: "/mcp/servers/builtin-1/enabled",
        body: { enabled: false },
      });
      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(svc.mcp.updateServerAsync).not.toHaveBeenCalled();
    });

    it("rejects PUT on a built-in server with 409 and does not persist", async () => {
      const svc = builtinServices();
      const res = await routeRequest(svc, {
        method: "PUT",
        path: "/mcp/servers/builtin-1",
        body: { name: "Hijack", transport: "streamableHttp", url: "https://evil.example.com/mcp" },
      });
      expect(res.status).toBe(409);
      expect(svc.mcp.updateServerAsync).not.toHaveBeenCalled();
    });

    it("rejects DELETE on a built-in server with 409 and does not remove", async () => {
      const svc = builtinServices();
      const res = await routeRequest(svc, {
        method: "DELETE",
        path: "/mcp/servers/builtin-1",
      });
      expect(res.status).toBe(409);
      expect(svc.mcp.removeServerAsync).not.toHaveBeenCalled();
    });
  });
});

describe("routeRequest - LLM", () => {
  it("GET /llm/config redacts apiKeys but reports hasApiKey", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/llm/config" });
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    const data = res.body.data as {
      languageModel: { apiKey: string; hasApiKey: boolean };
      providerApiKeys: Record<string, string>;
    };
    expect(data.languageModel.apiKey).toBe(REDACTED);
    expect(data.languageModel.hasApiKey).toBe(true);
    expect(data.providerApiKeys.openai).toBe(REDACTED);
    expect(JSON.stringify(data)).not.toContain("sk-secret-123");
  });

  it("POST /llm/config stores a v2 config and never returns the raw key", async () => {
    const services = makeServices();
    const body = {
      version: 2,
      languageModel: { provider: "openai", model: "gpt-4", apiKey: "sk-brand-new" },
      transcriptionModel: null,
    };
    const res = await routeRequest(services, { method: "POST", path: "/llm/config", body });
    expect(res.status).toBe(200);
    expect(services.llm.storeLLMConfig).toHaveBeenCalledWith(body);
    if (!res.body.ok) throw new Error("expected ok");
    expect(JSON.stringify(res.body.data)).not.toContain("sk-secret-123");
  });

  it("POST /llm/config rejects non-v2 payloads", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/llm/config",
      body: { version: 1 },
    });
    expect(res.status).toBe(400);
    expect(services.llm.storeLLMConfig).not.toHaveBeenCalled();
  });

  it("GET /llm/config defaults orchestrationBackend to 'openai' when unset", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/llm/config" });
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    expect((res.body.data as { orchestrationBackend: string }).orchestrationBackend).toBe("openai");
  });

  it("GET /llm/config returns the default backend on a fresh install (null config)", async () => {
    const services = makeServices({
      llm: {
        getLLMConfig: vi.fn().mockResolvedValue(null),
        storeLLMConfig: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await routeRequest(services, { method: "GET", path: "/llm/config" });
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    // Must surface a concrete value, never null, even when no config exists yet.
    expect(res.body.data).toEqual({ orchestrationBackend: "openai" });
  });
});

describe("routeRequest - LLM orchestrator", () => {
  it("POST /llm/config/orchestrator sets the backend, preserving models + keys", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/llm/config/orchestrator",
      body: { orchestrationBackend: "local-claude" },
    });
    expect(res.status).toBe(200);
    // Persisted config merges the backend onto the existing config (keys intact).
    expect(services.llm.storeLLMConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        orchestrationBackend: "local-claude",
        languageModel: expect.objectContaining({ provider: "openai" }),
        providerApiKeys: { openai: "sk-secret-123" },
      }),
    );
    // The response never echoes the raw key.
    if (!res.body.ok) throw new Error("expected ok");
    expect(JSON.stringify(res.body.data)).not.toContain("sk-secret-123");
  });

  it("POST /llm/config/orchestrator creates a minimal v2 config when none exists", async () => {
    const services = makeServices({
      llm: {
        getLLMConfig: vi
          .fn()
          // first call: none; second call (after store): the stored value
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            version: 2,
            languageModel: null,
            transcriptionModel: null,
            orchestrationBackend: "openai",
          }),
        storeLLMConfig: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await routeRequest(services, {
      method: "POST",
      path: "/llm/config/orchestrator",
      body: { orchestrationBackend: "openai" },
    });
    expect(res.status).toBe(200);
    expect(services.llm.storeLLMConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        languageModel: null,
        transcriptionModel: null,
        orchestrationBackend: "openai",
      }),
    );
  });

  it("POST /llm/config/orchestrator rejects an invalid backend via zod", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/llm/config/orchestrator",
      body: { orchestrationBackend: "gpt5" },
    });
    expect(res.status).toBe(400);
    expect(services.llm.storeLLMConfig).not.toHaveBeenCalled();
  });

  it("POST /llm/config/orchestrator rejects a missing backend", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/llm/config/orchestrator",
      body: {},
    });
    expect(res.status).toBe(400);
    expect(services.llm.storeLLMConfig).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods on /llm/config/orchestrator", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "GET",
      path: "/llm/config/orchestrator",
    });
    expect(res.status).toBe(405);
  });
});

describe("routeRequest - settings", () => {
  it("GET /settings returns user settings", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/settings" });
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    expect((res.body.data as { toolApprovalMode: string }).toolApprovalMode).toBe("ask");
  });

  it("PATCH /settings validates via the shared zod schema", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "PATCH",
      path: "/settings",
      body: { toolApprovalMode: "yolo" },
    });
    expect(res.status).toBe(200);
    expect(services.settings.updateSettingsAsync).toHaveBeenCalledWith({
      toolApprovalMode: "yolo",
    });
  });

  it("PATCH /settings rejects an invalid approval mode", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "PATCH",
      path: "/settings",
      body: { toolApprovalMode: "nonsense" },
    });
    expect(res.status).toBe(400);
    expect(services.settings.updateSettingsAsync).not.toHaveBeenCalled();
  });
});

describe("routeRequest - misc", () => {
  it("404s an unknown route", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/nope" });
    expect(res.status).toBe(404);
  });

  it("returns 500 and the message when a service throws", async () => {
    const services = makeServices({
      mcp: {
        ...makeServices().mcp,
        listAvailableServers: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });
    const res = await routeRequest(services, { method: "GET", path: "/mcp/servers" });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    if (res.body.ok) throw new Error("expected error");
    expect(res.body.error).toBe("boom");
  });
});
