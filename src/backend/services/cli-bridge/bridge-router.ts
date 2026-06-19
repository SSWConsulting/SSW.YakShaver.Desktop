import {
  type BridgeResponse,
  McpEnabledInputSchema,
  McpServerInputSchema,
  McpServerPatchSchema,
  OrchestratorInputSchema,
} from "../../../shared/cli-bridge/protocol";
import {
  redactLlmConfig,
  redactMcpServer,
  redactMcpServers,
} from "../../../shared/cli-bridge/redact";
import { DEFAULT_ORCHESTRATION_BACKEND, type LLMConfigV2 } from "../../../shared/types/llm";
import type { PartialUserSettings, UserSettings } from "../../../shared/types/user-settings";
import { PartialUserSettingsSchema } from "../../../shared/types/user-settings";
import type { MCPServerConfig } from "../mcp/types";

/**
 * Service surface the router depends on. The real bridge wires this to the
 * existing singletons (MCPServerManager, LlmStorage, UserSettingsStorage); tests
 * pass mocks. This keeps the routing logic free of Electron and easily testable.
 */
export interface BridgeServices {
  mcp: {
    listAvailableServers(): Promise<MCPServerConfig[]>;
    addServerAsync(config: MCPServerConfig): Promise<MCPServerConfig>;
    updateServerAsync(serverId: string, config: MCPServerConfig): Promise<void>;
    removeServerAsync(serverId: string): Promise<void>;
    getServerByIdAsync(serverId: string): Promise<MCPServerConfig | undefined>;
  };
  llm: {
    getLLMConfig(): Promise<LLMConfigV2 | null>;
    storeLLMConfig(config: LLMConfigV2): Promise<void>;
  };
  settings: {
    getSettingsAsync(): Promise<UserSettings>;
    updateSettingsAsync(patch: PartialUserSettings): Promise<void>;
  };
}

export interface BridgeRequest {
  method: string;
  /** Path WITHOUT query string, e.g. "/mcp/servers/abc". */
  path: string;
  /** Parsed JSON body (already validated as JSON upstream). */
  body?: unknown;
}

export interface BridgeResult {
  status: number;
  body: BridgeResponse;
}

const ok = <T>(data: T, status = 200): BridgeResult => ({ status, body: { ok: true, data } });
const fail = (error: string, status = 400): BridgeResult => ({
  status,
  body: { ok: false, error },
});

/**
 * Route a single parsed request to the backing services and produce a JSON
 * envelope. Auth is handled by the HTTP layer BEFORE this is ever called.
 */
export async function routeRequest(
  services: BridgeServices,
  req: BridgeRequest,
): Promise<BridgeResult> {
  try {
    const segments = req.path.split("/").filter(Boolean);

    // /mcp/...
    if (segments[0] === "mcp" && segments[1] === "servers") {
      return await routeMcp(services, req, segments.slice(2));
    }

    // /llm/config and /llm/config/orchestrator
    if (segments[0] === "llm" && segments[1] === "config") {
      if (segments.length === 2) {
        return await routeLlm(services, req);
      }
      if (segments.length === 3 && segments[2] === "orchestrator") {
        return await routeLlmOrchestrator(services, req);
      }
    }

    // /settings
    if (segments[0] === "settings" && segments.length === 1) {
      return await routeSettings(services, req);
    }

    return fail(`Unknown route: ${req.method} ${req.path}`, 404);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

async function routeMcp(
  services: BridgeServices,
  req: BridgeRequest,
  rest: string[],
): Promise<BridgeResult> {
  // /mcp/servers
  if (rest.length === 0) {
    if (req.method === "GET") {
      const servers = await services.mcp.listAvailableServers();
      return ok(redactMcpServers(servers));
    }
    if (req.method === "POST") {
      const parsed = McpServerInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(`Invalid server config: ${formatZodError(parsed.error)}`);
      }
      const created = await services.mcp.addServerAsync(parsed.data as MCPServerConfig);
      return ok(redactMcpServer(created), 201);
    }
    return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
  }

  const serverId = decodeURIComponent(rest[0]);

  // /mcp/servers/:id/enabled
  if (rest.length === 2 && rest[1] === "enabled") {
    if (req.method !== "POST") {
      return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
    }
    const parsed = McpEnabledInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(`Invalid payload: ${formatZodError(parsed.error)}`);
    }
    const existing = await services.mcp.getServerByIdAsync(serverId);
    if (!existing) {
      return fail(`MCP server '${serverId}' not found`, 404);
    }
    const updated = { ...existing, enabled: parsed.data.enabled } as MCPServerConfig;
    await services.mcp.updateServerAsync(serverId, updated);
    return ok(redactMcpServer(updated));
  }

  // /mcp/servers/:id
  if (rest.length === 1) {
    if (req.method === "PUT") {
      // Merge-update: validate ONLY the provided fields (every field optional)
      // and overlay them on the existing server. The server must already exist.
      const parsed = McpServerPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(`Invalid server config: ${formatZodError(parsed.error)}`);
      }
      const existing = await services.mcp.getServerByIdAsync(serverId);
      if (!existing) {
        return fail(`MCP server '${serverId}' not found`, 404);
      }
      const merged = {
        ...existing,
        ...(parsed.data as object),
        id: serverId,
      } as MCPServerConfig;
      await services.mcp.updateServerAsync(serverId, merged);
      return ok(redactMcpServer(merged));
    }
    if (req.method === "DELETE") {
      await services.mcp.removeServerAsync(serverId);
      return ok({ id: serverId, removed: true });
    }
    return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
  }

  return fail(`Unknown route: ${req.method} ${req.path}`, 404);
}

async function routeLlm(services: BridgeServices, req: BridgeRequest): Promise<BridgeResult> {
  if (req.method === "GET") {
    const config = await services.llm.getLLMConfig();
    const redacted = redactLlmConfig(config);
    // Surface the effective orchestration backend so `config get` always shows a
    // concrete value even when the field has never been set (defaults to openai).
    if (redacted && typeof redacted === "object") {
      const r = redacted as Record<string, unknown>;
      if (r.orchestrationBackend === undefined) {
        r.orchestrationBackend = DEFAULT_ORCHESTRATION_BACKEND;
      }
    }
    return ok(redacted);
  }
  if (req.method === "POST") {
    if (!req.body || typeof req.body !== "object") {
      return fail("Invalid LLM config payload");
    }
    const config = req.body as LLMConfigV2;
    if (config.version !== 2) {
      return fail("LLM config must be version 2");
    }
    await services.llm.storeLLMConfig(config);
    const stored = await services.llm.getLLMConfig();
    return ok(redactLlmConfig(stored));
  }
  return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
}

/**
 * Set only the orchestration backend on the current LLMConfigV2.
 *
 * Merges server-side so the existing models + api keys are preserved (the CLI
 * never sends or echoes secrets). When no config exists yet a minimal V2 config
 * is created with the chosen backend.
 */
async function routeLlmOrchestrator(
  services: BridgeServices,
  req: BridgeRequest,
): Promise<BridgeResult> {
  if (req.method !== "POST") {
    return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
  }
  const parsed = OrchestratorInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(`Invalid orchestrator payload: ${formatZodError(parsed.error)}`);
  }

  const existing = await services.llm.getLLMConfig();
  const merged: LLMConfigV2 = existing
    ? { ...existing, orchestrationBackend: parsed.data.orchestrationBackend }
    : {
        version: 2,
        languageModel: null,
        transcriptionModel: null,
        orchestrationBackend: parsed.data.orchestrationBackend,
      };

  await services.llm.storeLLMConfig(merged);
  const stored = await services.llm.getLLMConfig();
  return ok(redactLlmConfig(stored));
}

async function routeSettings(services: BridgeServices, req: BridgeRequest): Promise<BridgeResult> {
  if (req.method === "GET") {
    return ok(await services.settings.getSettingsAsync());
  }
  if (req.method === "PATCH") {
    const parsed = PartialUserSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(`Invalid settings patch: ${formatZodError(parsed.error)}`);
    }
    await services.settings.updateSettingsAsync(parsed.data);
    return ok(await services.settings.getSettingsAsync());
  }
  return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
}

function formatZodError(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
