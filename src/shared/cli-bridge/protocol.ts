import { z } from "zod";

/**
 * Shared protocol definitions for the YakShaver CLI bridge.
 *
 * The bridge is a localhost-only HTTP server started by the desktop app's main
 * process. The `yakshaver` CLI talks to it. Both sides import the constants and
 * Zod schemas here so the wire format stays in lockstep.
 */

/** Name of the token file written under `userData/yakshaver-tokens/`. */
export const CLI_BRIDGE_TOKEN_FILE = "cli-bridge.json";

/** Directory (relative to userData) where secure tokens live. */
export const CLI_BRIDGE_TOKEN_DIR = "yakshaver-tokens";

/** Host the bridge binds to. Localhost ONLY — never expose to the network. */
export const CLI_BRIDGE_HOST = "127.0.0.1";

/** Default port the bridge attempts to bind. May fall back to an ephemeral port. */
export const CLI_BRIDGE_DEFAULT_PORT = 8765;

/** Env var that, when truthy, disables the bridge entirely. */
export const CLI_BRIDGE_DISABLE_ENV = "YAKSHAVER_DISABLE_CLI_BRIDGE";

/** Placeholder shown instead of any secret value. */
export const REDACTED = "***redacted***";

/** Shape of the token file the app writes and the CLI reads. */
export interface CliBridgeTokenFile {
  port: number;
  token: string;
  /** ISO timestamp the bridge last (re)started. Informational only. */
  startedAt: string;
  /** App version, for diagnostics. */
  version?: string;
}

export const CliBridgeTokenFileSchema = z.object({
  port: z.number().int().positive(),
  token: z.string().min(1),
  startedAt: z.string(),
  version: z.string().optional(),
});

/** Envelope every endpoint returns. */
export type BridgeResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// MCP server payload schemas (subset of MCPServerConfig the CLI can set).
// Mirrors the validation the MCPServerManager performs internally, but lets us
// reject bad input early at the bridge boundary.
// ---------------------------------------------------------------------------

const stringRecord = z.record(z.string(), z.string());

const baseFields = {
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  toolWhitelist: z.array(z.string()).optional(),
};

export const HttpServerInputSchema = z.object({
  ...baseFields,
  transport: z.literal("streamableHttp"),
  url: z.string().url("url must be a valid URL"),
  headers: stringRecord.optional(),
  version: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const StdioServerInputSchema = z.object({
  ...baseFields,
  transport: z.literal("stdio"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  cwd: z.string().optional(),
  stderr: z.enum(["inherit", "ignore", "pipe"]).optional(),
});

/** Input accepted by POST /mcp/servers and PUT /mcp/servers/:id. */
export const McpServerInputSchema = z.discriminatedUnion("transport", [
  HttpServerInputSchema,
  StdioServerInputSchema,
]);
export type McpServerInput = z.infer<typeof McpServerInputSchema>;

/**
 * Input accepted by PUT /mcp/servers/:id (merge-update).
 *
 * Unlike {@link McpServerInputSchema}, every field is optional so callers can
 * send ONLY the fields they want to change. The router merges the provided
 * fields onto the existing server config. `transport` is optional here; when
 * omitted the existing transport is preserved.
 */
export const McpServerPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    toolWhitelist: z.array(z.string()).optional(),
    transport: z.enum(["stdio", "streamableHttp"]).optional(),
    // http
    url: z.string().url("url must be a valid URL").optional(),
    headers: stringRecord.optional(),
    timeoutMs: z.number().int().positive().optional(),
    // stdio
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: stringRecord.optional(),
    cwd: z.string().optional(),
    stderr: z.enum(["inherit", "ignore", "pipe"]).optional(),
    version: z.string().optional(),
  })
  .strict();
export type McpServerPatch = z.infer<typeof McpServerPatchSchema>;

/** Input accepted by POST /mcp/servers/:id/enabled. */
export const McpEnabledInputSchema = z.object({
  enabled: z.boolean(),
});

/** Orchestration backends the CLI may set. Mirrors `OrchestrationBackend`. */
export const OrchestrationBackendSchema = z.enum(["openai", "local-claude"]);

/** Input accepted by POST /llm/config/orchestrator. */
export const OrchestratorInputSchema = z.object({
  orchestrationBackend: OrchestrationBackendSchema,
});

/**
 * Keys on an MCP server config considered secret. Redacted in any response.
 * `headers` and `env` often carry tokens/api keys so we redact their values.
 */
export const MCP_SECRET_KEYS = ["headers", "env"] as const;
