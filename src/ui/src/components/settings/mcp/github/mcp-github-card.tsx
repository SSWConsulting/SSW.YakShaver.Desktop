import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { useMcpCardActions } from "@/hooks/useMcpCardActions";
import type { HealthStatusInfo } from "../../../../../../backend/types";
import type { MCPServerConfig } from "../McpServerForm";
import { McpCard } from "../mcp-card";
import { GitHubIcon } from "./github-icon";

interface McpGitHubCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpGitHubCard.Name = "GitHub";
McpGitHubCard.Id = PRESET_SERVER_IDS.GITHUB;

export function McpGitHubCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpGitHubCardProps) {
  const configLocal = config ?? GITHUB_PRESET_CONFIG;

  const { handleOnConnect, handleOnDisconnect } = useMcpCardActions(
    McpGitHubCard.Id,
    configLocal,
    onChange,
  );

  return (
    <McpCard
      isReadOnly
      icon={<GitHubIcon />}
      config={configLocal}
      healthInfo={healthInfo}
      onConnect={handleOnConnect}
      onDisconnect={handleOnDisconnect}
      onTools={onTools}
      viewMode={viewMode}
    />
  );
}
