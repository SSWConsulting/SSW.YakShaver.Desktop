import { GitHubIcon } from "./github-icon";
import { McpCard } from "../mcp-card";
import { MCPServerConfig } from "../McpServerForm";
import { ipcClient } from "@/services/ipc-client";

interface McpGitHubCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
}

McpGitHubCard.Name = "GitHub";

export function McpGitHubCard({ config, onChange }: McpGitHubCardProps) {
  const serverName = McpGitHubCard.Name;

  const configLocal = config ?? {
    name: serverName,
    transport: "streamableHttp",
    url: "https://api.githubcopilot.com/mcp/",
    description: "GitHub MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  async function toggleSettings(status: boolean): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    await ipcClient.mcp.updateServerAsync(serverName, updatedConfig);
    if (onChange) {
      onChange(updatedConfig);
    }
  }

  function handleOnConnect(): void {
    toggleSettings(true);
  }
  function handleOnDisconnect(): void {
    toggleSettings(false);
  }

  return (
    <McpCard
      isReadOnly
      icon={<GitHubIcon />}
      config={configLocal}
      onConnect={handleOnConnect}
      onDisconnect={handleOnDisconnect}
    />
  );
}
