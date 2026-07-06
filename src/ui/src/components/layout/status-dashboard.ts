import type { LLMConfigV2, OrchestratorReadiness } from "@shared/types/llm";
import type { MCPServerConfig } from "@shared/types/mcp";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBacklogProviderHealth, isBacklogProvider } from "@/components/home/mcp-status";
import { fetchOrchestratorReadiness } from "@/components/settings/settings-health";
import { ipcClient } from "@/services/ipc-client";
import { AuthStatus, type HealthStatusInfo } from "@/types";

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
  llmConfig: Pick<LLMConfigV2, "languageModel" | "orchestrationBackend"> | null;
  /**
   * Readiness of the Claude Code orchestration backend (`ipcClient.llm.checkOrchestratorReadiness()`).
   * Only meaningful when `orchestrationBackend === "local-claude"`; null/undefined means "not
   * checked / inconclusive" and never raises a warning — mirrors settings-health.ts (#878/#936).
   */
  orchestratorReadiness?: OrchestratorReadiness | null;
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

  // Filter to backlog providers explicitly (mirrors mcp-status.ts's own
  // isBacklogProvider/enabled check) rather than relying on mcpHealthById only ever
  // containing entries for backlog providers — an implicit invariant that would
  // silently break if a caller ever passed health for non-backlog servers too.
  const connectedProviders = inputs.mcpServers
    .filter(isBacklogProvider)
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
  const hasApiKey = Boolean(languageModel && languageModel.apiKey.trim() !== "");
  // The local-claude orchestration backend drives the backlog-creation step
  // separately from the transcription/analysis `languageModel` above — a
  // configured apiKey doesn't mean that backend is actually ready (CLI missing
  // or not signed in), and settings-health.ts (#878/#936) already treats that as
  // a distinct critical state. Reusing the same readiness signal here means this
  // row can't silently report green while the orchestrator can't actually run.
  const usesLocalClaude = inputs.llmConfig?.orchestrationBackend === "local-claude";
  const readiness = inputs.orchestratorReadiness;
  const orchestratorNotReady = usesLocalClaude && !!readiness && !readiness.ready;

  const languageModelItem: StatusItem =
    hasApiKey && !orchestratorNotReady
      ? {
          level: "green",
          message: `Connected: ${languageModel?.model ?? languageModel?.provider}.`,
        }
      : orchestratorNotReady
        ? {
            level: "red",
            message:
              readiness?.state === "not-installed"
                ? "Claude Code CLI not found, so probably the shave will fail"
                : "Claude Code isn't signed in, so probably the shave will fail",
          }
        : {
            level: "red",
            message: "You don't have any language model connected, so probably the shave will fail",
          };

  return { login, mcp, languageModel: languageModelItem };
}

const DEFAULT_INPUTS: StatusDashboardInputs = {
  isAuthenticated: false,
  mcpServers: [],
  mcpHealthById: {},
  llmConfig: null,
  orchestratorReadiness: null,
};

/**
 * Reads the live auth/MCP/LLM state and returns the dashboard status. Re-checks on
 * mount, when the window regains focus, and on STATUS_DASHBOARD_REFRESH_EVENT, so
 * the sidebar stays in sync with changes made in Settings or via sign-in/out.
 */
export function useStatusDashboard(): StatusDashboard {
  const [dashboard, setDashboard] = useState<StatusDashboard>(() =>
    deriveStatusDashboard(DEFAULT_INPUTS),
  );

  // Bumped on every check() call and on unmount, so a check() that resolves after a
  // newer one started (or after unmount) is recognised as stale and its result is
  // dropped instead of overwriting fresher state / setting state on an unmounted
  // component.
  const requestIdRef = useRef(0);

  const check = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    try {
      const [authState, { servers: mcpServers, healthById: mcpHealthById }, llmConfig] =
        await Promise.all([
          ipcClient.auth.identityServer
            .status()
            .catch(() => ({ status: AuthStatus.NOT_AUTHENTICATED })),
          fetchBacklogProviderHealth(),
          ipcClient.llm.getConfig().catch(() => null),
        ]);

      // Only probe Claude Code readiness when it's the selected backend — otherwise
      // it's irrelevant and we skip the spawn entirely. Shared/de-duped with
      // settings-health.ts's useSettingsTabHealth via fetchOrchestratorReadiness (see its
      // docstring) so a single window-focus event doesn't spawn the `claude --version`
      // subprocess twice when Settings is also open.
      const orchestratorReadiness =
        llmConfig?.orchestrationBackend === "local-claude"
          ? await fetchOrchestratorReadiness()
          : null;

      if (requestIdRef.current !== requestId) return; // superseded or unmounted

      setDashboard(
        deriveStatusDashboard({
          isAuthenticated: authState.status === AuthStatus.AUTHENTICATED,
          mcpServers,
          mcpHealthById,
          llmConfig,
          orchestratorReadiness,
        }),
      );
    } catch {
      if (requestIdRef.current !== requestId) return; // superseded or unmounted

      // Couldn't read state — fall back to the conservative all-warning defaults
      // rather than showing a misleading green.
      setDashboard(deriveStatusDashboard(DEFAULT_INPUTS));
    }
  }, []);

  useEffect(() => {
    void check();
    const onRefresh = () => void check();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => {
      requestIdRef.current++; // invalidate any in-flight check() so it can't setState post-unmount
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    };
  }, [check]);

  return dashboard;
}
