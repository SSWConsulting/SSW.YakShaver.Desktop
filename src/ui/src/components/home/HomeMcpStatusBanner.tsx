import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ipcClient } from "@/services/ipc-client";
import type { HealthStatusInfo } from "@/types";
import {
  type DisconnectedProvider,
  isBacklogProvider,
  MCP_HEALTH_REFRESH_EVENT,
  selectDisconnectedProviders,
} from "./mcp-status";

/**
 * #869 — checks the health of the configured backlog provider MCP servers, using
 * the same source the MCP Settings page does (`checkServerHealthAsync`). Re-checks
 * on mount, when the window regains focus, and on the MCP_HEALTH_REFRESH_EVENT
 * (dispatched when the Settings dialog closes) so the result stays fresh (AC4).
 */
function useDisconnectedBacklogProviders(): DisconnectedProvider[] {
  const [disconnected, setDisconnected] = useState<DisconnectedProvider[]>([]);

  const check = useCallback(async () => {
    try {
      const servers = await ipcClient.mcp.listServers();
      const providers = servers.filter(isBacklogProvider);
      const healthById: Record<string, HealthStatusInfo | undefined> = {};
      await Promise.all(
        providers.map(async (server) => {
          try {
            healthById[server.id] = await ipcClient.mcp.checkServerHealthAsync(server.id);
          } catch {
            healthById[server.id] = { isHealthy: false, isChecking: false };
          }
        }),
      );
      setDisconnected(selectDisconnectedProviders(servers, healthById));
    } catch {
      // Couldn't list servers — say nothing rather than show a misleading warning.
      setDisconnected([]);
    }
  }, []);

  useEffect(() => {
    void check();
    const onRefresh = () => void check();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(MCP_HEALTH_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(MCP_HEALTH_REFRESH_EVENT, onRefresh);
    };
  }, [check]);

  return disconnected;
}

function openMcpSettings() {
  window.dispatchEvent(new CustomEvent("open-settings-tab", { detail: { tabId: "mcp" } }));
}

/**
 * #869 — a prominent Home banner shown when one or more configured backlog provider
 * MCP servers (e.g. GitHub, Azure DevOps) are disconnected, with a CTA to MCP
 * Settings. Renders nothing when every provider is connected.
 */
export function HomeMcpStatusBanner() {
  const disconnected = useDisconnectedBacklogProviders();

  if (disconnected.length === 0) return null;

  const names = disconnected.map((provider) => provider.name).join(", ");
  const verb = disconnected.length === 1 ? "is" : "are";

  return (
    <div
      role="alert"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-2 text-yellow-100">
        <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-300" />
        <span className="text-sm">
          <span className="font-medium text-yellow-200">{names}</span> {verb} disconnected. New
          backlog items can&rsquo;t be created until reconnected.
        </span>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={openMcpSettings}>
        Open MCP Settings
      </Button>
    </div>
  );
}
