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
McpGitHubCard.Id = "f12980ac-f80c-47e0-b4ac-181a54122d61";

export function McpGitHubCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpGitHubCardProps) {
  const configLocal = config ?? {
    id: McpGitHubCard.Id,
    name: McpGitHubCard.Name,
    transport: "streamableHttp",
    url: "https://api.githubcopilot.com/mcp/",
    description: "GitHub MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

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
