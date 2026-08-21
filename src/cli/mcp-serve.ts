import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  type BridgeToolSummary,
  CLI_BRIDGE_PORT_ENV,
  CLI_BRIDGE_SERVER_FILTER_ENV,
  CLI_BRIDGE_SHAVE_ID_ENV,
  CLI_BRIDGE_TOKEN_ENV,
  type ToolCallResult,
} from "../shared/cli-bridge/protocol";
import { BridgeClient, BridgeUnavailableError } from "./bridge-client";

/**
 * The single `yakshaver` MCP front-door (#915).
 *
 * Runs a stdio MCP SERVER that the Claude Code orchestrator spawns (via a
 * one-entry `--mcp-config`). It owns NO tools itself — every `tools/list` and
 * `tools/call` is proxied to the running desktop app over the localhost CLI
 * bridge:
 *
 *   tools/list → GET  /tools        (the app's full aggregated, server-prefixed
 *                                    toolset, INCLUDING internal/in-memory
 *                                    servers Claude Code can't reach directly)
 *   tools/call → POST /tools/call   (executes through the app's approval policy)
 *
 * To Claude the tools appear as `mcp__yakshaver__<Server__tool>`. The bridge
 * token+port are resolved from the same token file the rest of the CLI uses
 * (or env vars the orchestrator injects).
 */

export interface McpServeOptions {
  dev?: boolean;
  /** Injectable for testing. Defaults to a real {@link BridgeClient}. */
  client?: Pick<BridgeClient, "get" | "post">;
  /**
   * Server ids/names to restrict the toolset to. Injectable for testing; in production it is read
   * from {@link CLI_BRIDGE_SERVER_FILTER_ENV}, which the orchestrator sets to the project's
   * selected servers. Undefined/empty means every enabled server.
   */
  serverFilter?: string[];
  /**
   * The current shave's id, forwarded on `POST /tools/call` so a `wait`-mode approval prompt can
   * honour the per-shave auto-approve override (#920). Injectable for testing; in production it is
   * read from {@link CLI_BRIDGE_SHAVE_ID_ENV}.
   */
  shaveId?: string;
}

/**
 * Build the MCP `Server` instance, registering the list/call handlers that proxy
 * to the bridge. Exposed (separately from the transport) so tests can drive the
 * handlers directly without a real stdio pipe.
 */
export function createMcpServer(options: McpServeOptions = {}): Server {
  const client = options.client ?? buildClient(options.dev);
  // The orchestrator injects the project's selected servers; the front-door forwards them so the
  // app restricts the toolset (and tool execution) to that project, not every configured server.
  const serverFilter = options.serverFilter ?? readServerFilterFromEnv();
  const shaveId = options.shaveId ?? readShaveIdFromEnv();

  const server = new Server(
    { name: "yakshaver", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => listToolsViaBridge(client, serverFilter));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callToolViaBridge(client, request.params.name, request.params.arguments, serverFilter, shaveId),
  );

  return server;
}

/**
 * Proxy `tools/list` to `GET /tools`, mapping summaries to MCP tool descriptors.
 *
 * If the app/bridge becomes UNREACHABLE after the front-door is up (the user
 * quits/restarts the app, a socket drops mid-shave — surfaced as a
 * {@link BridgeUnavailableError}), discovery must not abort the whole session
 * with a JSON-RPC protocol error: it collapses to an empty toolset, mirroring
 * the bridge router's own never-throw-on-empty contract server-side
 * (`McpToolBridge.collectToolsOrEmpty`).
 *
 * A NON-availability failure (e.g. an authenticated-boundary 401 from a stale
 * token, or a malformed response) is a persistent misconfiguration, not a
 * transient dropout — silently returning `[]` would hide it forever, so we let
 * it propagate.
 */
export async function listToolsViaBridge(
  client: Pick<BridgeClient, "get">,
  serverFilter?: string[],
): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: object }> }> {
  let tools: BridgeToolSummary[];
  try {
    tools = await client.get<BridgeToolSummary[]>(`/tools${serverFilterQuery(serverFilter)}`);
  } catch (err) {
    if (err instanceof BridgeUnavailableError) {
      return { tools: [] };
    }
    throw err;
  }
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: normalizeInputSchema(t.inputSchema),
    })),
  };
}

/** The MCP tool-result shape this front-door returns over stdio. */
type McpToolResult = Pick<CallToolResult, "content" | "isError">;

/**
 * Proxy `tools/call` to `POST /tools/call`. Every failure path becomes an MCP
 * `isError` result (never a thrown JSON-RPC error, which would abort the run) so
 * the model sees it and can self-correct:
 *  - a non-`ok` bridge result (incl. a structured "not approved"),
 *  - a transport failure (app quit/restart, socket drop, non-JSON body),
 *  - a tool-level `isError` on an `ok:true` result — passed through verbatim so a
 *    tool FAILURE is never masked as success (matches the in-process orchestrator).
 *
 * Under `wait` approval mode, the bridge itself may block this call awaiting the user's response to
 * an approval dialog (#920) — safe because `BridgeClient.post` sets no request timeout, so this
 * simply waits like it would for any slow tool.
 */
export async function callToolViaBridge(
  client: Pick<BridgeClient, "post">,
  name: string,
  args: Record<string, unknown> | undefined,
  serverFilter?: string[],
  shaveId?: string,
): Promise<McpToolResult> {
  let result: ToolCallResult;
  try {
    result = await client.post<ToolCallResult>("/tools/call", {
      name,
      arguments: args ?? {},
      ...(serverFilter && serverFilter.length > 0 ? { serverFilter } : {}),
      ...(shaveId ? { shaveId } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Tool failed: ${message}` }],
    };
  }

  if (!result.ok) {
    const prefix = result.notApproved ? "Tool not approved: " : "Tool failed: ";
    return {
      isError: true,
      content: [{ type: "text", text: `${prefix}${result.error ?? "unknown error"}` }],
    };
  }

  // If the tool returned a native MCP CallToolResult, relay its content + isError
  // unchanged rather than stringifying it as a single text blob. This is what
  // preserves a tool-level failure (isError:true) instead of masking it as success.
  const passthrough = asMcpResult(result.result);
  if (passthrough) {
    return passthrough;
  }

  return { content: [toTextContent(result.result)] };
}

/**
 * Narrow an arbitrary `execute()` return value to an MCP `CallToolResult` shape
 * (`{ content: [...], isError? }`). Returns null when it isn't one, so the caller
 * falls back to stringifying. Only a `content` ARRAY qualifies — that is the MCP
 * contract — and `isError` is normalized to a boolean (defaulting to false).
 */
function asMcpResult(value: unknown): McpToolResult | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as { content?: unknown; isError?: unknown };
  if (!Array.isArray(obj.content)) return null;
  return {
    content: obj.content as CallToolResult["content"],
    isError: obj.isError === true,
  };
}

/** Start the front-door over stdio. Resolves when the transport closes. */
export async function runMcpServe(options: McpServeOptions = {}): Promise<void> {
  let server: Server;
  try {
    server = createMcpServer(options);
  } catch (err) {
    // A misconfigured/absent bridge must produce a CLEAR error, not a silent hang.
    fail(err);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process now lives until stdin closes; the SDK manages the lifecycle.
}

/** Construct a BridgeClient, honouring orchestrator-injected env overrides. */
function buildClient(dev?: boolean): BridgeClient {
  const port = process.env[CLI_BRIDGE_PORT_ENV];
  const token = process.env[CLI_BRIDGE_TOKEN_ENV];
  if (port && token) {
    const parsedPort = Number(port);
    if (Number.isFinite(parsedPort) && parsedPort > 0) {
      return new BridgeClient({
        dev,
        tokenLoader: async () => ({
          port: parsedPort,
          token,
          startedAt: new Date().toISOString(),
        }),
      });
    }
  }
  return new BridgeClient({ dev });
}

/** Read the comma-separated server filter the orchestrator injected, as a trimmed list (or undefined). */
function readServerFilterFromEnv(): string[] | undefined {
  const raw = process.env[CLI_BRIDGE_SERVER_FILTER_ENV];
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? ids : undefined;
}

/** Read the current shave id the orchestrator injected, if any (#920). */
function readShaveIdFromEnv(): string | undefined {
  const raw = process.env[CLI_BRIDGE_SHAVE_ID_ENV];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

/** Encode a server filter as a `?serverFilter=a,b` query suffix, or "" when there is none. */
function serverFilterQuery(serverFilter?: string[]): string {
  if (!serverFilter || serverFilter.length === 0) return "";
  return `?serverFilter=${encodeURIComponent(serverFilter.join(","))}`;
}

/** MCP requires `inputSchema` to be an object schema; default to a permissive one. */
function normalizeInputSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === "object" && schema.type === "object") {
    return schema;
  }
  return { type: "object", properties: {} };
}

/** Wrap a tool result as MCP text content (stringifying non-strings). */
function toTextContent(result: unknown): { type: "text"; text: string } {
  if (typeof result === "string") {
    return { type: "text", text: result };
  }
  return { type: "text", text: JSON.stringify(result ?? null) };
}

/** Print a clear, actionable error to stderr and set a non-zero exit code. */
function fail(err: unknown): void {
  const message =
    err instanceof BridgeUnavailableError
      ? err.message
      : `Failed to start the yakshaver MCP front-door: ${err instanceof Error ? err.message : String(err)}`;
  console.error(message);
  process.exitCode = 1;
}
