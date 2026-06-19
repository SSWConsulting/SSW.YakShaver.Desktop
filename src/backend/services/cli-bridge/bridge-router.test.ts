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
      listTools: vi.fn().mockResolvedValue([
        {
          name: "GitHub__create_issue",
          description: "Create a GitHub issue",
          inputSchema: { type: "object", properties: { title: { type: "string" } } },
        },
      ]),
      callTool: vi.fn().mockResolvedValue({ ok: true, result: "Created #5" }),
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

describe("routeRequest - tools (#915 aggregated front-door)", () => {
  it("GET /tools returns the aggregated tool list", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/tools" });
    expect(res.status).toBe(200);
    expect(services.tools.listTools).toHaveBeenCalledOnce();
    if (!res.body.ok) throw new Error("expected ok");
    const tools = res.body.data as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(["GitHub__create_issue"]);
  });

  it("GET /tools rejects non-GET methods", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "POST", path: "/tools" });
    expect(res.status).toBe(405);
  });

  it("POST /tools/call validates the body via zod", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/tools/call",
      body: { arguments: {} }, // missing required `name`
    });
    expect(res.status).toBe(400);
    expect(services.tools.callTool).not.toHaveBeenCalled();
  });

  it("POST /tools/call proxies name+arguments and returns the result envelope", async () => {
    const services = makeServices();
    const res = await routeRequest(services, {
      method: "POST",
      path: "/tools/call",
      body: { name: "GitHub__create_issue", arguments: { title: "Bug" } },
    });
    expect(res.status).toBe(200);
    expect(services.tools.callTool).toHaveBeenCalledWith("GitHub__create_issue", { title: "Bug" });
    if (!res.body.ok) throw new Error("expected ok envelope");
    expect(res.body.data).toEqual({ ok: true, result: "Created #5" });
  });

  it("POST /tools/call surfaces a structured not-approved result as a 200 envelope (no hang)", async () => {
    const services = makeServices({
      tools: {
        listTools: vi.fn(),
        callTool: vi
          .fn()
          .mockResolvedValue({ ok: false, notApproved: true, error: "not approved" }),
      },
    });
    const res = await routeRequest(services, {
      method: "POST",
      path: "/tools/call",
      body: { name: "GitHub__create_issue" },
    });
    // Tool-level refusal is still a successful BRIDGE response.
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok envelope");
    expect(res.body.data).toEqual({ ok: false, notApproved: true, error: "not approved" });
  });

  it("POST /tools/call rejects non-POST methods", async () => {
    const services = makeServices();
    const res = await routeRequest(services, { method: "GET", path: "/tools/call" });
    expect(res.status).toBe(405);
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
