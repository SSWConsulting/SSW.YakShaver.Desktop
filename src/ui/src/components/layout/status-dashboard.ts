import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import type { LLMConfigV2 } from "@shared/types/llm";
import type { MCPServerConfig } from "@shared/types/mcp";
import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import type { HealthStatusInfo } from "@/types";

/**
 * #948 — a sidebar status dashboard (between "Projects" and "Settings") that
 * surfaces the three things that silently cause a shave to fail: the user isn't
 * logged in, no MCP server is connected, or no language model is configured.
 * Today none of this is visible until a shave fails, so this dashboard gives an
 * always-on, at-a-glance signal instead.
 *
 * `deriveStatusDashboard` is a pure function (unit-testable without IPC);
 * `useStatusDashboard` wires it to the live `ipcClient` reads and keeps it fresh.
 */

/** Window event the dashboard listens for to re-check status (dispatched when the
 * Settings dialog closes, mirroring MCP_HEALTH_REFRESH_EVENT / SETTINGS_HEALTH_REFRESH_EVENT). */
export const STATUS_DASHBOARD_REFRESH_EVENT = "yakshaver:status-dashboard-refresh";

/** The known backlog-provider MCP server ids (GitHub / Azure DevOps / Jira). Only
 * these count toward "at least one MCP server connected" — mirrors #869/#878. */
const BACKLOG_PROVIDER_IDS = new Set<string>(Object.values(PRESET_SERVER_IDS));

export type StatusLevel = "green" | "yellow" | "red";

export interface StatusItem {
  level: StatusLevel;
  message: string;
}

export interface StatusDashboard {
  login: StatusItem;
  mcp: StatusItem;
  languageModel: StatusItem;
}

function isEnabledBacklogProvider(server: Pick<MCPServerConfig, "id" | "enabled">) {
  return server.enabled !== false && BACKLOG_PROVIDER_IDS.has(server.id);
}

export interface StatusDashboardInputs {
  /** Whether the user is signed in (`ipcClient.auth.identityServer.status()`). */
  isAuthenticated: boolean;
  /** Configured MCP servers (`ipcClient.mcp.listServers()`). */
  mcpServers: ReadonlyArray<Pick<MCPServerConfig, "id" | "name" | "enabled">>;
  /** Health by server id; only an explicit `isHealthy === true` counts as connected
   * (an undefined/still-loading entry is NOT treated as connected, avoiding a false
   * green flash while checks are in flight). */
  mcpHealthById: Readonly<Record<string, Pick<HealthStatusInfo, "isHealthy"> | undefined>>;
  /** The persisted LLM config (`ipcClient.llm.getConfig()`), or null if unset. */
  llmConfig: Pick<LLMConfigV2, "languageModel"> | null;
}

/**
 * Pure mapping from raw config/health reads to the three dashboard rows. Each rule
 * only reports what it can positively confirm — an unknown/loading value never
 * flips a row to green, so the dashboard doesn't flash a false "all good".
 */
export function deriveStatusDashboard(inputs: StatusDashboardInputs): StatusDashboard {
  const login: StatusItem = inputs.isAuthenticated
    ? { level: "green", message: "Signed in." }
    : {
        level: "yellow",
        message: "Your shave will not be synced with the portal, etc.",
      };

  const connectedProviders = inputs.mcpServers
    .filter(isEnabledBacklogProvider)
    .filter((server) => inputs.mcpHealthById[server.id]?.isHealthy === true);
  const mcp: StatusItem =
    connectedProviders.length > 0
      ? {
          level: "green",
          message: `Connected: ${connectedProviders.map((s) => s.name).join(", ")}.`,
        }
      : {
          level: "red",
          message: "You don't have any MCP server connected, so the shave or request might fail",
        };

  const languageModel = inputs.llmConfig?.languageModel;
  const hasLanguageModel = Boolean(languageModel && languageModel.apiKey.trim() !== "");
  const languageModelItem: StatusItem = hasLanguageModel
    ? { level: "green", message: `Connected: ${languageModel?.model ?? languageModel?.provider}.` }
    : {
        level: "red",
        message: "You don't have any language model connected, so probably the shave will fail",
      };

  return { login, mcp, languageModel: languageModelItem };
}

/**
 * Reads the live auth/MCP/LLM state and returns the dashboard status. Re-checks on
 * mount, when the window regains focus, and on STATUS_DASHBOARD_REFRESH_EVENT, so
 * the sidebar stays in sync with changes made in Settings or via sign-in/out.
 */
export function useStatusDashboard(): StatusDashboard {
  const [dashboard, setDashboard] = useState<StatusDashboard>(() =>
    deriveStatusDashboard({
      isAuthenticated: false,
      mcpServers: [],
      mcpHealthById: {},
      llmConfig: null,
    }),
  );

  const check = useCallback(async () => {
    try {
      const [authState, mcpServers, llmConfig] = await Promise.all([
        ipcClient.auth.identityServer
          .status()
          .catch(() => ({ status: "unauthenticated" as const })),
        ipcClient.mcp.listServers().catch(() => [] as MCPServerConfig[]),
        ipcClient.llm.getConfig().catch(() => null),
      ]);

      const backlog = mcpServers.filter(isEnabledBacklogProvider);
      const mcpHealthById: Record<string, HealthStatusInfo | undefined> = {};
      await Promise.all(
        backlog.map(async (server) => {
          try {
            mcpHealthById[server.id] = await ipcClient.mcp.checkServerHealthAsync(server.id);
          } catch {
            // A failed probe is inconclusive, not "connected" — leave undefined so
            // deriveStatusDashboard doesn't raise a false green.
            mcpHealthById[server.id] = undefined;
          }
        }),
      );

      setDashboard(
        deriveStatusDashboard({
          isAuthenticated: authState.status === "authenticated",
          mcpServers,
          mcpHealthById,
          llmConfig,
        }),
      );
    } catch {
      // Couldn't read state — fall back to the conservative all-warning defaults
      // rather than showing a misleading green.
      setDashboard(
        deriveStatusDashboard({
          isAuthenticated: false,
          mcpServers: [],
          mcpHealthById: {},
          llmConfig: null,
        }),
      );
    }
  }, []);

  useEffect(() => {
    void check();
    const onRefresh = () => void check();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    };
  }, [check]);

  return dashboard;
}
