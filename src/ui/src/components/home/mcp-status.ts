import type { MCPServerConfig } from "@shared/types/mcp";
import type { HealthStatusInfo } from "@/types";

/** Window event the Home banner listens for to re-check provider health
 * (e.g. dispatched when the Settings dialog closes, so reconnecting there
 * updates Home — #869 AC4). */
export const MCP_HEALTH_REFRESH_EVENT = "yakshaver:mcp-health-refresh";

export interface DisconnectedProvider {
  id: string;
  name: string;
}

/**
 * The "backlog provider" MCP servers a user has set up: the non-builtin servers
 * (GitHub / Azure DevOps / Jira / custom) that are enabled — i.e. expected to be
 * connected. The builtin Yak_* tool servers are not backlog providers.
 */
export function isBacklogProvider(server: Pick<MCPServerConfig, "id" | "builtin" | "enabled">) {
  return !server.builtin && server.enabled !== false && Boolean(server.id);
}

/**
 * #869 — which configured backlog providers are currently disconnected.
 * Only counts a provider as disconnected when its health has been checked and is
 * explicitly unhealthy (`isHealthy === false`); an unchecked/undefined health
 * (still loading) is NOT reported, so the banner never flashes a false warning.
 */
export function selectDisconnectedProviders(
  servers: ReadonlyArray<Pick<MCPServerConfig, "id" | "name" | "builtin" | "enabled">>,
  healthById: Readonly<Record<string, Pick<HealthStatusInfo, "isHealthy"> | undefined>>,
): DisconnectedProvider[] {
  return servers
    .filter(isBacklogProvider)
    .filter((server) => healthById[server.id]?.isHealthy === false)
    .map((server) => ({ id: server.id, name: server.name }));
}
