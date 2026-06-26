import { randomUUID } from "node:crypto";
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
   * The aggregated, server-prefixed toolset — INCLUDING internal/in-memory servers (the #915 win:
   * reachable here even though Claude Code can't reach them over its own transports). When
   * `serverFilter` is given, only those server ids/names are included (the project's selected
   * servers); otherwise every enabled server is.
   */
  collectToolsForSelectedServersAsync(serverFilter?: string[]): Promise<ToolSet>;
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
  async listTools(serverFilter?: string[]): Promise<BridgeToolSummary[]> {
    const tools = await this.collectToolsOrEmpty(serverFilter);
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
   * Enforces the approval policy first, NEVER hanging. Only `ask` gates on the
   * whitelist (a non-whitelisted tool returns `{ok:false, notApproved:true}`
   * rather than waiting on a prompt the headless caller can't answer). `yolo` and
   * `wait` both run everything — matching the orchestrator's `buildArgv`, which
   * maps `wait` to `bypassPermissions` because the OpenAI backend's `wait` is
   * "auto-approve after a delay", not a hard deny. Treating `wait` like `ask` here
   * would hard-deny every non-whitelisted tool and break wait-mode runs.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    serverFilter?: string[],
  ): Promise<ToolCallResult> {
    // Resolve against the SAME filtered toolset `listTools` exposes, so a tool from an unselected
    // project isn't reachable even if the model guesses its name (the server-side gate for #915).
    const tools = await this.collectToolsOrEmpty(serverFilter);
    const tool = tools[name];
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }

    const approvalMode = (await this.settings.getSettingsAsync()).toolApprovalMode;
    if (approvalMode === "ask") {
      const whitelist = new Set(await this.manager.getWhitelistWithServerPrefixAsync());
      if (!whitelist.has(name)) {
        return {
          ok: false,
          notApproved: true,
          error: `Tool '${name}' is not approved under the 'ask' approval mode. Whitelist it in YakShaver, or switch the approval mode to 'yolo'.`,
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
        toolCallId: `bridge-${randomUUID()}`,
        messages: [],
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Resolve the aggregated toolset, treating the "no healthy/enabled servers"
   * degenerate state as an EMPTY toolset rather than an error.
   *
   * {@link ToolBridgeManager.collectToolsForSelectedServersAsync} throws when zero
   * enabled servers are healthy (e.g. the first-run "no MCP servers configured"
   * state, every configured server failing to connect, or a `serverFilter` that
   * matches nothing). That throw must NOT propagate to the bridge router (which
   * would relay it as an HTTP 500 and make the front-door reject mid-run).
   * Honouring the bridge's "never hang, always return a structured envelope"
   * contract, we collapse it to `{}`:
   *  - `listTools()` then returns an empty list (tools/list ⇒ []), and
   *  - `callTool()` then returns the existing structured `{ok:false, "Unknown
   *    tool"}` refusal, which the front-door relays as an MCP `isError` result.
   */
  private async collectToolsOrEmpty(serverFilter?: string[]): Promise<ToolSet> {
    try {
      return await this.manager.collectToolsForSelectedServersAsync(serverFilter);
    } catch {
      return {} as ToolSet;
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
