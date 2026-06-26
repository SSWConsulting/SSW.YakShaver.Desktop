import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import type { LLMConfigV2 } from "@shared/types/llm";
import type { MCPServerConfig } from "@shared/types/mcp";
import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import type { HealthStatusInfo } from "@/types";

/**
 * #878 — surfacing unhealthy/invalid Settings configuration on the side nav.
 *
 * A single shared source of truth for "which Settings page has a critical
 * configuration problem", so the nav indicators (and any per-page banner that
 * reuses this) stay consistent. The detection (`deriveSettingsHealth`) is a pure
 * function so it can be unit-tested without IPC; `useSettingsTabHealth` wires it
 * to the live `ipcClient` reads.
 */

/** Window event the nav listens for to re-check health (e.g. after a settings
 * change elsewhere reconnects a provider or saves a key). */
export const SETTINGS_HEALTH_REFRESH_EVENT = "yakshaver:settings-health-refresh";

/** Backlog-provider MCP server ids (GitHub / Azure DevOps / Jira presets). Only
 * these surface a critical "can't create work items" state — an unrelated custom
 * MCP server going unhealthy is not a critical Settings misconfiguration. */
const BACKLOG_PROVIDER_IDS = new Set<string>(Object.values(PRESET_SERVER_IDS));

export interface SettingsTabHealth {
  tabId: string;
  severity: "critical";
  /** Human-readable explanation shown in the nav tooltip / aria-label. */
  message: string;
}

export type SettingsHealthMap = Readonly<Record<string, SettingsTabHealth | undefined>>;

export interface SettingsHealthInputs {
  /** The persisted LLM config (`ipcClient.llm.getConfig()`), or null if unset. */
  llmConfig: Pick<LLMConfigV2, "languageModel"> | null;
  /** Configured MCP servers (`ipcClient.mcp.listServers()`). */
  mcpServers: ReadonlyArray<Pick<MCPServerConfig, "id" | "name" | "enabled">>;
  /** Health by server id; only an explicit `isHealthy === false` counts as down
   * (an undefined/still-loading entry is NOT treated as disconnected, so the nav
   * never flashes a false warning while checks are in flight). */
  mcpHealthById: Readonly<Record<string, Pick<HealthStatusInfo, "isHealthy"> | undefined>>;
  /** Whether a GitHub token is saved (`ipcClient.githubToken.has()`). */
  hasGithubToken: boolean;
}

function isEnabledBacklogProvider(server: Pick<MCPServerConfig, "id" | "enabled">) {
  return server.enabled !== false && BACKLOG_PROVIDER_IDS.has(server.id);
}

/**
 * Pure mapping from raw config reads to the per-tab critical-state map. Each rule
 * is deliberately conservative: it only reports a problem it can positively
 * confirm from the data, never on an unknown/loading value.
 */
export function deriveSettingsHealth(inputs: SettingsHealthInputs): SettingsHealthMap {
  const map: Record<string, SettingsTabHealth> = {};

  // Model Settings — no usable language model means the core transcribe/analyse
  // pipeline cannot run, so a missing model or empty API key is critical.
  const languageModel = inputs.llmConfig?.languageModel;
  if (!languageModel || languageModel.apiKey.trim() === "") {
    map.llm = {
      tabId: "llm",
      severity: "critical",
      message: "No language model API key is configured.",
    };
  }

  // MCP Settings — an enabled backlog provider that is confirmed disconnected
  // means new work items can't be created (mirrors the Home banner, #869).
  const disconnected = inputs.mcpServers
    .filter(isEnabledBacklogProvider)
    .filter((server) => inputs.mcpHealthById[server.id]?.isHealthy === false)
    .map((server) => server.name);
  if (disconnected.length > 0) {
    const verb = disconnected.length === 1 ? "is" : "are";
    map.mcp = {
      tabId: "mcp",
      severity: "critical",
      message: `${disconnected.join(", ")} ${verb} disconnected. New backlog items can't be created until reconnected.`,
    };
  }

  // Releases — the GitHub token gates GitHub release-channel/token-backed actions.
  if (!inputs.hasGithubToken) {
    map.release = {
      tabId: "release",
      severity: "critical",
      message: "No GitHub token saved.",
    };
  }

  return map;
}

/**
 * Reads the live configuration and returns the per-tab critical-state map.
 * Re-checks when the dialog opens, when the window regains focus, and on the
 * SETTINGS_HEALTH_REFRESH_EVENT, so the nav stays in sync with changes made on
 * the pages themselves.
 */
export function useSettingsTabHealth(open: boolean): SettingsHealthMap {
  const [health, setHealth] = useState<SettingsHealthMap>({});

  const check = useCallback(async () => {
    try {
      const [llmConfig, mcpServers, hasGithubToken] = await Promise.all([
        ipcClient.llm.getConfig().catch(() => null),
        ipcClient.mcp.listServers().catch(() => [] as MCPServerConfig[]),
        ipcClient.githubToken.has().catch(() => true),
      ]);

      // Only probe health for the enabled backlog providers we might flag.
      const backlog = mcpServers.filter(isEnabledBacklogProvider);
      const mcpHealthById: Record<string, HealthStatusInfo | undefined> = {};
      await Promise.all(
        backlog.map(async (server) => {
          try {
            mcpHealthById[server.id] = await ipcClient.mcp.checkServerHealthAsync(server.id);
          } catch {
            // A failed probe is inconclusive, not "disconnected" — leave undefined
            // so deriveSettingsHealth doesn't raise a false critical state.
            mcpHealthById[server.id] = undefined;
          }
        }),
      );

      setHealth(deriveSettingsHealth({ llmConfig, mcpServers, mcpHealthById, hasGithubToken }));
    } catch {
      // Couldn't read config — say nothing rather than show a misleading indicator.
      setHealth({});
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void check();
    const onRefresh = () => void check();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(SETTINGS_HEALTH_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(SETTINGS_HEALTH_REFRESH_EVENT, onRefresh);
    };
  }, [open, check]);

  return health;
}
