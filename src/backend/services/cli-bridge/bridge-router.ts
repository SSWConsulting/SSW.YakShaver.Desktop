import {
  type BridgeResponse,
  type BridgeToolSummary,
  LlmConfigInputSchema,
  McpEnabledInputSchema,
  McpServerInputSchema,
  type McpServerPatch,
  McpServerPatchSchema,
  OrchestratorInputSchema,
  ToolCallInputSchema,
  type ToolCallResult,
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
  /**
   * Aggregated MCP toolset front-door (#915). Exposes the app's full,
   * server-prefixed toolset (incl. internal/in-memory servers) and proxies
   * tool execution through the app's approval policy.
   */
  tools: {
    listTools(serverFilter?: string[]): Promise<BridgeToolSummary[]>;
    callTool(
      name: string,
      args?: Record<string, unknown>,
      serverFilter?: string[],
      shaveId?: string,
    ): Promise<ToolCallResult>;
  };
}

export interface BridgeRequest {
  method: string;
  /** Path WITHOUT query string, e.g. "/mcp/servers/abc". */
  path: string;
  /** Parsed JSON body (already validated as JSON upstream). */
  body?: unknown;
  /** Parsed query-string params, e.g. `{ serverFilter: "a,b" }` for `GET /tools`. */
  query?: Record<string, string>;
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

    // /tools and /tools/call
    if (segments[0] === "tools") {
      return await routeTools(services, req, segments.slice(1));
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
      // Merge-update: validate the provided fields, then merge via mergeMcpPatch
      // (which normalizes a transport switch). The server must already exist.
      const parsed = McpServerPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return fail(`Invalid server config: ${formatZodError(parsed.error)}`);
      }
      const existing = await services.mcp.getServerByIdAsync(serverId);
      if (!existing) {
        return fail(`MCP server '${serverId}' not found`, 404);
      }
      if (existing.builtin) {
        return fail(BUILTIN_IMMUTABLE_MESSAGE, 409);
      }
      const mergeResult = mergeMcpPatch(existing, parsed.data);
      if (!mergeResult.ok) {
        return fail(mergeResult.error);
      }
      const merged = mergeResult.value;
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
    const redacted = redactLlmConfig(config);
    // Surface the effective orchestration backend so `config get` always shows a
    // concrete value even when the field has never been set (defaults to openai).
    if (redacted && typeof redacted === "object") {
      const r = redacted as Record<string, unknown>;
      if (r.orchestrationBackend === undefined) {
        r.orchestrationBackend = DEFAULT_ORCHESTRATION_BACKEND;
      }
      return ok(redacted);
    }
    // Fresh install: no LLM config yet (null) — surface the default, not `null`.
    return ok({ orchestrationBackend: DEFAULT_ORCHESTRATION_BACKEND });
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

/**
 * Aggregated toolset front-door (#915).
 *
 *  - `GET  /tools`       → the full server-prefixed tool list (incl. internal/
 *    in-memory servers), names + descriptions + JSON-Schema only.
 *  - `POST /tools/call`  → execute one tool by name; the approval policy is
 *    enforced inside the tools service so a refusal is a structured result, not
 *    an HTTP error (the caller must surface it, not retry).
 */
async function routeTools(
  services: BridgeServices,
  req: BridgeRequest,
  rest: string[],
): Promise<BridgeResult> {
  // /tools
  if (rest.length === 0) {
    if (req.method !== "GET") {
      return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
    }
    // Restrict to the project's selected servers when the front-door forwards a filter
    // (`?serverFilter=a,b`); absent/empty means every enabled server.
    const tools = await services.tools.listTools(parseServerFilter(req.query?.serverFilter));
    return ok(tools);
  }

  // /tools/call
  if (rest.length === 1 && rest[0] === "call") {
    if (req.method !== "POST") {
      return fail(`Method not allowed: ${req.method} ${req.path}`, 405);
    }
    const parsed = ToolCallInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(`Invalid tool call: ${formatZodError(parsed.error)}`);
    }
    const result = await services.tools.callTool(
      parsed.data.name,
      parsed.data.arguments ?? {},
      parsed.data.serverFilter,
      parsed.data.shaveId,
    );
    // A tool-level failure (incl. a structured "not approved") is still a
    // successful BRIDGE response — the envelope carries {ok:false,...} so the
    // MCP front-door can relay it to the model verbatim. Only transport/route
    // problems use a non-200 status.
    return ok(result);
  }

  return fail(`Unknown route: ${req.method} ${req.path}`, 404);
}

/** Parse a `serverFilter` query value (`"a,b"`) into a trimmed id/name list, or undefined if empty. */
function parseServerFilter(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? ids : undefined;
}

/** Fields that belong ONLY to an HTTP (streamableHttp) server config. */
const HTTP_ONLY_FIELDS = ["url", "headers", "version", "timeoutMs"] as const;
/** Fields that belong ONLY to a stdio server config. */
const STDIO_ONLY_FIELDS = ["command", "args", "env", "cwd", "stderr"] as const;

type MergeResult = { ok: true; value: MCPServerConfig } | { ok: false; error: string };

/**
 * Merge a validated patch onto an existing MCP server config, normalized to the
 * TARGET transport: fields belonging only to the OTHER transport are stripped so
 * no foreign field survives (whether the patch switches transport or just slips
 * in a wrong-transport field). A transport switch also requires the new
 * transport's mandatory field (`url` for HTTP, `command` for stdio).
 */
function mergeMcpPatch(existing: MCPServerConfig, patch: McpServerPatch): MergeResult {
  const targetTransport = patch.transport ?? existing.transport;
  const transportChanged = patch.transport !== undefined && patch.transport !== existing.transport;

  const merged: Record<string, unknown> = {
    ...(existing as unknown as Record<string, unknown>),
    ...(patch as Record<string, unknown>),
    id: existing.id,
  };

  // Strip the OTHER transport's fields so no foreign field survives.
  const staleFields = targetTransport === "streamableHttp" ? STDIO_ONLY_FIELDS : HTTP_ONLY_FIELDS;
  for (const field of staleFields) {
    delete merged[field];
  }

  if (transportChanged) {
    // Require the new transport's mandatory field (from the patch or existing).
    if (targetTransport === "streamableHttp" && typeof merged.url !== "string") {
      return {
        ok: false,
        error: "Changing transport to http requires --url",
      };
    }
    if (targetTransport === "stdio" && typeof merged.command !== "string") {
      return {
        ok: false,
        error: "Changing transport to stdio requires --command",
      };
    }
  }

  return { ok: true, value: merged as unknown as MCPServerConfig };
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
