import type { MCPServerConfig } from "../types/mcp";
import { REDACTED } from "./protocol";

/**
 * Redaction helpers shared by the bridge (so secrets never leave the app) and
 * importable by the CLI/tests. We never echo full secret values back over the
 * wire — api keys, bearer tokens, and arbitrary header/env values are masked.
 */

function redactStringMap(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!map) return map;
  const out: Record<string, string> = {};
  for (const key of Object.keys(map)) {
    out[key] = REDACTED;
  }
  return out;
}

/** Redact secret-bearing fields on a single MCP server config. */
export function redactMcpServer(server: MCPServerConfig): MCPServerConfig {
  const clone = { ...(server as unknown as Record<string, unknown>) };

  if ("headers" in clone) {
    clone.headers = redactStringMap(clone.headers as Record<string, string> | undefined);
  }
  if ("env" in clone) {
    clone.env = redactStringMap(clone.env as Record<string, string> | undefined);
  }

  return clone as unknown as MCPServerConfig;
}

/** Redact a list of MCP server configs. */
export function redactMcpServers(servers: MCPServerConfig[]): MCPServerConfig[] {
  return servers.map(redactMcpServer);
}

/**
 * Redact an LLM config (V2 shape). Replaces every `apiKey` with the placeholder
 * but keeps `hasApiKey` booleans so callers can tell whether a key is set.
 */
export function redactLlmConfig(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;

  const redactModel = (model: unknown): unknown => {
    if (!model || typeof model !== "object") return model;
    const m = model as Record<string, unknown>;
    const hasApiKey = typeof m.apiKey === "string" && m.apiKey.length > 0;
    return { ...m, apiKey: hasApiKey ? REDACTED : m.apiKey, hasApiKey };
  };

  const c = config as Record<string, unknown>;
  const out: Record<string, unknown> = { ...c };

  if ("languageModel" in c) out.languageModel = redactModel(c.languageModel);
  if ("transcriptionModel" in c) out.transcriptionModel = redactModel(c.transcriptionModel);

  if (c.providerApiKeys && typeof c.providerApiKeys === "object") {
    const masked: Record<string, string> = {};
    for (const key of Object.keys(c.providerApiKeys as Record<string, unknown>)) {
      masked[key] = REDACTED;
    }
    out.providerApiKeys = masked;
  }

  return out;
}
