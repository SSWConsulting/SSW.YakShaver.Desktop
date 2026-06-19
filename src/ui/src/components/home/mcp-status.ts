import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import type { MCPServerConfig } from "@shared/types/mcp";
import type { HealthStatusInfo } from "@/types";

/** Window event the Home banner listens for to re-check provider health
 * (e.g. dispatched when the Settings dialog closes, so reconnecting there
 * updates Home — #869 AC4). */
export const MCP_HEALTH_REFRESH_EVENT = "yakshaver:mcp-health-refresh";

/**
 * The known backlog-provider MCP server ids (GitHub / Azure DevOps / Jira).
 * Only these surface the backlog-specific Home warning. A custom MCP server has
 * no backlog/category marker on its config, so treating every non-builtin server
 * as a backlog provider would falsely claim "backlog items can't be created" when
 * an unrelated custom server (e.g. a docs/search MCP) goes unhealthy (#869 review).
 */
const BACKLOG_PROVIDER_IDS = new Set<string>(Object.values(PRESET_SERVER_IDS));

export interface DisconnectedProvider {
  id: string;
  name: string;
}

/**
 * Whether a configured MCP server is a backlog provider we expect to be connected
 * (one of the known presets), and is enabled. Builtin Yak_* tools and unrelated
 * custom servers are not backlog providers.
 */
export function isBacklogProvider(server: Pick<MCPServerConfig, "id" | "enabled">) {
  return server.enabled !== false && BACKLOG_PROVIDER_IDS.has(server.id);
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
