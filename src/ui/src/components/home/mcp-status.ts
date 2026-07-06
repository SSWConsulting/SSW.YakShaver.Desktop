import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import type { MCPServerConfig } from "@shared/types/mcp";
import { ipcClient } from "@/services/ipc-client";
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

/**
 * Fetches the configured MCP servers plus health for the backlog-provider subset,
 * de-duplicating concurrent callers into a single in-flight round.
 *
 * Both `HomeMcpStatusBanner` and the sidebar `StatusDashboard` (#948) need this same
 * "list servers, then probe health for backlog providers" data, and both re-check on
 * the same triggers (window focus, the health-refresh event). Before #948, only the
 * Home banner ran this — always on a single mounted instance. #948 mounts a second,
 * always-on consumer (the sidebar dashboard is rendered on every route via Layout),
 * so a naive second copy of this loop would fire a second, fully independent round of
 * live `checkServerHealthAsync` probes on every focus event whenever Home is also
 * mounted — doubling MCP health IO for no benefit. Caching the in-flight promise here
 * means concurrent callers within the same tick share one underlying fetch.
 */
let inFlightHealthFetch: Promise<{
  servers: MCPServerConfig[];
  healthById: Record<string, HealthStatusInfo | undefined>;
}> | null = null;

export function fetchBacklogProviderHealth(): Promise<{
  servers: MCPServerConfig[];
  healthById: Record<string, HealthStatusInfo | undefined>;
}> {
  if (inFlightHealthFetch) return inFlightHealthFetch;

  inFlightHealthFetch = (async () => {
    try {
      const servers = await ipcClient.mcp.listServers();
      const backlog = servers.filter(isBacklogProvider);
      const healthById: Record<string, HealthStatusInfo | undefined> = {};
      await Promise.all(
        backlog.map(async (server) => {
          try {
            healthById[server.id] = await ipcClient.mcp.checkServerHealthAsync(server.id);
          } catch {
            // A failed probe is a confirmed-disconnected, not "connected" (mirrors the
            // convention already used here for a `false`-health server).
            healthById[server.id] = { isHealthy: false, isChecking: false };
          }
        }),
      );
      return { servers, healthById };
    } finally {
      inFlightHealthFetch = null;
    }
  })();

  return inFlightHealthFetch;
}
