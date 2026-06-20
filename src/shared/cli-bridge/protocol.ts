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

/**
 * Directory (relative to userData) the handshake file is written to. It shares
 * the `yakshaver-tokens` folder with the safeStorage-encrypted `*.enc`
 * credentials, but unlike those the bridge handshake file is PLAINTEXT JSON: the
 * non-Electron CLI cannot decrypt safeStorage, so it must be able to read the
 * port + bearer token directly. The bridge binds to localhost only and the file
 * is written owner-only (mode 0o600, a no-op on Windows). See AGENTS.md →
 * "Security & Privacy" for the documented exception to the encrypt-all rule.
 */
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
  url: z.url("url must be a valid URL"),
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

/** Input accepted by POST /mcp/servers/:id/enabled. */
export const McpEnabledInputSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Keys on an MCP server config considered secret. Redacted in any response.
 * `headers` and `env` often carry tokens/api keys so we redact their values.
 */
export const MCP_SECRET_KEYS = ["headers", "env"] as const;
