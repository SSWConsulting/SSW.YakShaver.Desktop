import { asSchema, type ToolSet } from "ai";
import type { BridgeToolSummary, ToolCallResult } from "../../../shared/cli-bridge/protocol";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";

/**
 * The slice of {@link MCPServerManager} the tool bridge needs. Kept narrow so the
 * router (and its unit tests) can inject a mock without dragging in Electron, the
 * MCP clients, or the storage singletons.
 */
export interface ToolBridgeManager {
  /**
   * The aggregated, server-prefixed toolset across ALL enabled servers —
   * INCLUDING internal/in-memory ones (the #915 win: these are reachable here
   * even though Claude Code cannot reach them over its own transports).
   */
  collectToolsWithServerPrefixAsync(): Promise<ToolSet>;
  /** Prefixed tool names that may run without interactive approval. */
  getWhitelistWithServerPrefixAsync(): Promise<string[]>;
}

/** The settings slice the bridge needs to read the current approval mode. */
export interface ToolBridgeSettings {
  getSettingsAsync(): Promise<{ toolApprovalMode: ToolApprovalMode }>;
}

/**
 * Bridges the app's aggregated MCP toolset to the localhost bridge endpoints
 * (`GET /tools`, `POST /tools/call`) consumed by the single `yakshaver` MCP
 * front-door (#915).
 *
 * Two responsibilities:
 *  1. Flatten the AI-SDK `ToolSet` (server-prefixed keys → `description` +
 *     JSON-Schema `inputSchema`) into wire-friendly summaries.
 *  2. Apply the app's tool-approval policy SERVER-SIDE on every call so a
 *     headless run never hangs on an interactive prompt: `yolo` runs everything;
 *     `ask`/`wait` run only whitelisted tools, otherwise return a STRUCTURED
 *     "not approved" result.
 */
export class McpToolBridge {
  constructor(
    private readonly manager: ToolBridgeManager,
    private readonly settings: ToolBridgeSettings,
  ) {}

  /** Aggregated tool list for `GET /tools`. Names/descriptions/schemas only. */
  async listTools(): Promise<BridgeToolSummary[]> {
    const tools = await this.manager.collectToolsWithServerPrefixAsync();
    const summaries: BridgeToolSummary[] = [];
    for (const [name, tool] of Object.entries(tools)) {
      summaries.push({
        name,
        description: extractDescription(tool),
        inputSchema: await extractInputSchema(tool),
      });
    }
    return summaries;
  }

  /**
   * Execute a single tool by its server-prefixed name for `POST /tools/call`.
   *
   * Enforces the approval policy first, NEVER hanging: under `ask`/`wait` a
   * non-whitelisted tool returns `{ok:false, notApproved:true}` rather than
   * waiting on a UI prompt the headless caller can't answer. (Phase 4.1 will
   * route these to the in-app approval UI; for v1 it's a clean refusal.)
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const tools = await this.manager.collectToolsWithServerPrefixAsync();
    const tool = tools[name];
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }

    const approvalMode = (await this.settings.getSettingsAsync()).toolApprovalMode;
    if (approvalMode !== "yolo") {
      const whitelist = new Set(await this.manager.getWhitelistWithServerPrefixAsync());
      if (!whitelist.has(name)) {
        return {
          ok: false,
          notApproved: true,
          error: `Tool '${name}' is not approved under the '${approvalMode}' approval mode. Whitelist it in YakShaver, or switch the approval mode to 'yolo'.`,
        };
      }
    }

    const execute = (tool as { execute?: unknown }).execute;
    if (typeof execute !== "function") {
      return { ok: false, error: `Tool '${name}' is not executable` };
    }

    try {
      // The AI-SDK execute signature is execute(input, options). The bridge has
      // no streaming context, so we pass a minimal options object.
      const result = await (execute as ToolExecute)(args, {
        toolCallId: `bridge-${Date.now()}`,
        messages: [],
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

type ToolExecute = (
  input: unknown,
  options: { toolCallId: string; messages: unknown[] },
) => Promise<unknown> | unknown;

function extractDescription(tool: unknown): string | undefined {
  if (tool && typeof tool === "object" && "description" in tool) {
    const desc = (tool as { description?: unknown }).description;
    return typeof desc === "string" ? desc : undefined;
  }
  return undefined;
}

/**
 * Resolve a tool's `inputSchema` (an AI-SDK FlexibleSchema — Zod, JSON-Schema, or
 * Standard Schema) to a plain JSON Schema object the MCP front-door can hand to
 * Claude. Falls back to a permissive empty-object schema if resolution fails.
 */
async function extractInputSchema(tool: unknown): Promise<Record<string, unknown>> {
  const fallback: Record<string, unknown> = { type: "object", properties: {} };
  if (!tool || typeof tool !== "object" || !("inputSchema" in tool)) {
    return fallback;
  }
  const raw = (tool as { inputSchema?: unknown }).inputSchema;
  if (raw === undefined || raw === null) return fallback;
  try {
    const schema = asSchema(raw as never);
    const json = await schema.jsonSchema;
    return (json as Record<string, unknown>) ?? fallback;
  } catch {
    // Some tools may already expose a plain JSON-Schema object directly.
    if (typeof raw === "object") return raw as Record<string, unknown>;
    return fallback;
  }
}
