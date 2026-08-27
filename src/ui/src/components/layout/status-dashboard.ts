import type { LLMConfigV2, OrchestratorReadiness } from "@shared/types/llm";
import type { MCPServerConfig } from "@shared/types/mcp";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBacklogProviderHealth, isBacklogProvider } from "@/components/home/mcp-status";
import { fetchOrchestratorReadiness } from "@/components/settings/settings-health";
import { ipcClient } from "@/services/ipc-client";
import { AuthStatus, type HealthStatusInfo } from "@/types";

/**
 * #948 — a sidebar status dashboard (between "Projects" and "Settings") that
 * surfaces the things that silently cause a shave to fail: the user isn't logged
 * in, no video host is connected, no MCP server is connected, or no language
 * model is configured. Today none of this is visible until a shave fails, so this
 * dashboard gives an always-on, at-a-glance signal instead.
 *
 * The video-host row exists because a missing video host is the one failure the
 * user hits *before* a shave even starts: ScreenRecorder disables Record until a
 * video host is connected, and the sidebar renders it with `showButtonOnly`, which
 * omits ScreenRecorder's own "Please connect a video platform below" hint — so the
 * button just greys out with no explanation anywhere on screen.
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
  videoHost: StatusItem;
  mcp: StatusItem;
  languageModel: StatusItem;
}

export interface StatusDashboardInputs {
  /** Whether the user is signed in (`ipcClient.auth.identityServer.status()`). */
  isAuthenticated: boolean;
  /**
   * The raw auth status, when known — lets the login row distinguish a brief
   * in-progress sign-in (AUTHENTICATING) from a settled NOT_AUTHENTICATED/ERROR, so
   * it doesn't show the "not synced" warning while a sign-in is actively underway.
   * Optional/omitted falls back to the same two-state (`isAuthenticated`) behaviour.
   */
  authStatus?: AuthStatus;
  /**
   * The video-host (YouTube) connection status, read from `YouTubeAuthContext` — the exact
   * same state ScreenRecorder gates the Record button on, so the row and the button can
   * never disagree. Ignored in YakShaver Anywhere (cloud-360) mode, where the "video host"
   * is Identity Server sign-in instead. Optional/omitted counts as not connected.
   */
  videoHostStatus?: AuthStatus;
  /**
   * True while that connection check is still in flight (`YouTubeAuthContext.isLoading`).
   * The context reports NOT_AUTHENTICATED until its first check resolves, so without this a
   * connected user would see the red "no video host" warning flash on every app launch —
   * the mirror image of the "never flash a false green" rule the other rows follow.
   */
  isVideoHostLoading?: boolean;
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
 * Mirrors ScreenRecorder's own `isVideoHostConnected` gate exactly, so this row always
 * explains the state of the Record button rather than guessing at it: in YakShaver
 * Anywhere (cloud-360) mode the "video host" is Identity Server sign-in; in every other
 * mode it's the YouTube connection.
 */
function deriveVideoHostStatus(inputs: StatusDashboardInputs): StatusItem {
  if (inputs.llmConfig?.orchestrationBackend === "cloud-360") {
    if (inputs.isAuthenticated) {
      return { level: "green", message: "Connected: YakShaver Anywhere." };
    }
    if (inputs.authStatus === AuthStatus.AUTHENTICATING) {
      return { level: "yellow", message: "Signing in…" };
    }
    return {
      level: "red",
      message: "Sign in to YakShaver Anywhere before you can start recording",
    };
  }

  if (inputs.videoHostStatus === AuthStatus.AUTHENTICATED) {
    return { level: "green", message: "Connected: YouTube." };
  }
  if (inputs.videoHostStatus === AuthStatus.AUTHENTICATING) {
    return { level: "yellow", message: "Connecting…" };
  }
  if (inputs.isVideoHostLoading) {
    return { level: "yellow", message: "Checking connection…" };
  }
  return {
    level: "red",
    message: "You don't have any video host connected, so you can't start recording",
  };
}

/**
 * Pure mapping from raw config/health reads to the dashboard rows. Each rule
 * only reports what it can positively confirm — an unknown/loading value never
 * flips a row to green, so the dashboard doesn't flash a false "all good".
 */
export function deriveStatusDashboard(inputs: StatusDashboardInputs): StatusDashboard {
  const login: StatusItem = inputs.isAuthenticated
    ? { level: "green", message: "Signed in." }
    : inputs.authStatus === AuthStatus.AUTHENTICATING
      ? { level: "yellow", message: "Signing in…" }
      : {
          level: "yellow",
          message: "Your shave will not be synced with the portal.",
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

  return {
    login,
    videoHost: deriveVideoHostStatus(inputs),
    mcp,
    languageModel: languageModelItem,
  };
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
 *
 * `videoHostStatus` is passed in (from `YouTubeAuthContext`) rather than fetched here on
 * purpose: `ipcClient.youtube.getAuthStatus()` calls the YouTube API to resolve the channel,
 * which would mean a network round-trip on every window focus, and reading the same context
 * ScreenRecorder gates Record on keeps the row and the button in lockstep. The IPC-read
 * inputs are held as raw state so a context change re-derives without re-running any IPC.
 */
export function useStatusDashboard(
  videoHostStatus?: AuthStatus,
  isVideoHostLoading?: boolean,
): StatusDashboard {
  const [inputs, setInputs] = useState<StatusDashboardInputs>(DEFAULT_INPUTS);

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

      setInputs({
        isAuthenticated: authState.status === AuthStatus.AUTHENTICATED,
        authStatus: authState.status,
        mcpServers,
        mcpHealthById,
        llmConfig,
        orchestratorReadiness,
      });
    } catch {
      if (requestIdRef.current !== requestId) return; // superseded or unmounted

      // Couldn't read state — fall back to the conservative all-warning defaults
      // rather than showing a misleading green.
      setInputs(DEFAULT_INPUTS);
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

  return useMemo(
    () => deriveStatusDashboard({ ...inputs, videoHostStatus, isVideoHostLoading }),
    [inputs, videoHostStatus, isVideoHostLoading],
  );
}
