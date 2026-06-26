import type { MCPServerConfig } from "../types/mcp";

/**
 * Returns the IDs of built-in MCP servers from the given list.
 * Used to pre-select built-in servers when creating a new custom prompt.
 * The id guard defends against deserialized storage objects with missing ids.
 */
export function getBuiltinServerIds(servers: readonly MCPServerConfig[]): string[] {
  return servers
    .filter((s) => s.builtin)
    .map((s) => s.id)
    .filter((id): id is string => !!id);
}

/**
 * Returns the IDs of servers that are either built-in or currently connected (enabled).
 * Used to compute which servers are selectable in the prompt editor.
 */
export function getConnectedOrBuiltinIds(servers: readonly MCPServerConfig[]): Set<string> {
  return new Set(
    servers
      .filter((s) => s.builtin || s.enabled !== false)
      .map((s) => s.id)
      .filter((id): id is string => !!id),
  );
}

/**
 * Preserves the current prompt selection while ensuring built-in servers stay selected.
 * This avoids dropping temporarily disabled external servers from saved prompt configs.
 */
export function ensureBuiltinServerIds(
  selectedServerIds: readonly string[] | undefined,
  servers: readonly MCPServerConfig[],
): string[] {
  return [...new Set([...(selectedServerIds ?? []), ...getBuiltinServerIds(servers)])];
}
