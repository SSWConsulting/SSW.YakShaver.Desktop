import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { BridgeToolSummary, ToolCallResult } from "../shared/cli-bridge/protocol";
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

/** Env var overrides the orchestrator may inject so we skip the token-file read. */
const BRIDGE_PORT_ENV = "YAKSHAVER_BRIDGE_PORT";
const BRIDGE_TOKEN_ENV = "YAKSHAVER_BRIDGE_TOKEN";

export interface McpServeOptions {
  dev?: boolean;
  /** Injectable for testing. Defaults to a real {@link BridgeClient}. */
  client?: Pick<BridgeClient, "get" | "post">;
}

/**
 * Build the MCP `Server` instance, registering the list/call handlers that proxy
 * to the bridge. Exposed (separately from the transport) so tests can drive the
 * handlers directly without a real stdio pipe.
 */
export function createMcpServer(options: McpServeOptions = {}): Server {
  const client = options.client ?? buildClient(options.dev);

  const server = new Server(
    { name: "yakshaver", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => listToolsViaBridge(client));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callToolViaBridge(client, request.params.name, request.params.arguments),
  );

  return server;
}

/** Proxy `tools/list` to `GET /tools`, mapping summaries to MCP tool descriptors. */
export async function listToolsViaBridge(
  client: Pick<BridgeClient, "get">,
): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: object }> }> {
  const tools = await client.get<BridgeToolSummary[]>("/tools");
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
 * Proxy `tools/call` to `POST /tools/call`. A non-`ok` bridge result (incl. a
 * structured "not approved") becomes an MCP `isError` tool result so the model
 * sees the refusal rather than treating it as silent success.
 *
 * A bridge-level success (`ok:true`) may still carry an MCP `CallToolResult` whose
 * own `isError` is true (auth-denied, rate-limit, validation — these resolve
 * WITHOUT throwing). We pass that shape through verbatim, preserving both the
 * original `content` AND the `isError` flag, so an underlying tool FAILURE is
 * never surfaced to Claude as a successful call. (The in-process orchestrator
 * does the same — see mcp-orchestrator.ts: `ok: !toolErrored`.)
 */
export async function callToolViaBridge(
  client: Pick<BridgeClient, "post">,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  const result = await client.post<ToolCallResult>("/tools/call", {
    name,
    arguments: args ?? {},
  });

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
  const port = process.env[BRIDGE_PORT_ENV];
  const token = process.env[BRIDGE_TOKEN_ENV];
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
