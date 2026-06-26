import { UsageError } from "./commands";

/**
 * Resolve a unique MCP server id from a list of servers (as returned by
 * `GET /mcp/servers`) given a server name.
 *
 * Pure and side-effect free so the matching + ambiguity rules are unit-testable
 * in isolation. Matching is case-sensitive and exact on `name`.
 *
 * @throws {UsageError} when zero or more than one server matches the name.
 */
export function resolveServerIdByName(servers: unknown, name: string): string {
  const list = Array.isArray(servers) ? servers : [];
  const matches = list.filter(
    (s): s is { id?: unknown; name?: unknown } =>
      !!s && typeof s === "object" && (s as { name?: unknown }).name === name,
  );

  if (matches.length === 0) {
    throw new UsageError(`No MCP server found with name '${name}'`);
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => String(m.id ?? "?")).join(", ");
    throw new UsageError(
      `Multiple MCP servers match name '${name}' (ids: ${ids}). Use the positional <id> instead.`,
    );
  }

  const id = matches[0].id;
  if (typeof id !== "string" || id.length === 0) {
    throw new UsageError(`MCP server '${name}' has no usable id`);
  }
  return id;
}
