import type { LLMConfigV2 } from "@shared/types/llm";
import {
  type BridgeResponse,
  LlmConfigInputSchema,
  McpEnabledInputSchema,
  McpServerInputSchema,
} from "../../../shared/cli-bridge/protocol";
import {
  redactLlmConfig,
  redactMcpServer,
  redactMcpServers,
} from "../../../shared/cli-bridge/redact";
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

/**
 * Built-in (internal/preset) MCP servers are managed by the app and must not be
 * mutated through the bridge — the desktop UI excludes them from its
 * enable/edit/delete surface (McpServerManager.tsx), so the bridge mirrors that
 * invariant instead of silently persisting a phantom row the merge logic ignores.
 */
const BUILTIN_IMMUTABLE_MESSAGE = "Cannot modify a built-in MCP server";

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

    // /llm/config
    if (segments[0] === "llm" && segments[1] === "config") {
      return await routeLlm(services, req);
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
    if (existing.builtin) {
      return fail(BUILTIN_IMMUTABLE_MESSAGE, 409);
    }
    const updated = { ...existing, enabled: parsed.data.enabled } as MCPServerConfig;
    await services.mcp.updateServerAsync(serverId, updated);
    return ok(redactMcpServer(updated));
  }

  // /mcp/servers/:id
  if (rest.length === 1) {
    if (req.method === "PUT") {
      const parsed = McpServerInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(`Invalid server config: ${formatZodError(parsed.error)}`);
      }
      const existing = await services.mcp.getServerByIdAsync(serverId);
      if (existing?.builtin) {
        return fail(BUILTIN_IMMUTABLE_MESSAGE, 409);
      }
      const merged = {
        ...(existing ?? {}),
        ...(parsed.data as object),
        id: serverId,
      } as MCPServerConfig;
      await services.mcp.updateServerAsync(serverId, merged);
      return ok(redactMcpServer(merged));
    }
    if (req.method === "DELETE") {
      const existing = await services.mcp.getServerByIdAsync(serverId);
      if (existing?.builtin) {
        return fail(BUILTIN_IMMUTABLE_MESSAGE, 409);
      }
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
    return ok(redactLlmConfig(config));
  }
  if (req.method === "POST") {
    const parsed = LlmConfigInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(`Invalid LLM config: ${formatZodError(parsed.error)}`);
    }
    await services.llm.storeLLMConfig(parsed.data as LLMConfigV2);
    const stored = await services.llm.getLLMConfig();
    return ok(redactLlmConfig(stored));
  }
  return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
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
