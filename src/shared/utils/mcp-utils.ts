import type { MCPServerConfig } from "../types/mcp";

/**
 * Returns the IDs of built-in MCP servers from the given list.
 * Used to pre-select built-in servers when creating a new custom prompt.
 */
export function getBuiltinServerIds(servers: MCPServerConfig[]): string[] {
  return servers
    .filter((s) => s.builtin)
    .map((s) => s.id)
    .filter((id): id is string => !!id);
}
