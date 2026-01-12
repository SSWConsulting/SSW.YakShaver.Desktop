import { GitHubIcon } from "./github-icon";
import { McpCard } from "../mcp-card";
import { MCPServerConfig } from "../McpServerForm";
import { ipcClient } from "@/services/ipc-client";


interface McpGitHubCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
}

McpGitHubCard.Name = "GitHub";
McpGitHubCard.Id = "f12980ac-f80c-47e0-b4ac-181a54122d61";

export function McpGitHubCard({ config, onChange }: McpGitHubCardProps) {
  ;

  const configLocal = config ?? {
    id: McpGitHubCard.Id,
    name: McpGitHubCard.Name,
    transport: "streamableHttp",
    url: "https://api.githubcopilot.com/mcp/",
    description: "GitHub MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  async function toggleSettings(status: boolean): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    console.log("Updating GitHub MCP config:", updatedConfig, McpGitHubCard.Id);
    await ipcClient.mcp.updateServerAsync(McpGitHubCard.Id, updatedConfig);

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
