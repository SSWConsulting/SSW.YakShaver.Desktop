import { GitHubIcon } from "./github-icon";
import { McpCard } from "../mcp-card";
import { MCPServerConfig } from "../McpServerForm";
import { ipcClient } from "@/services/ipc-client";
import { HealthStatusInfo } from "../../../../../../backend/types";
import { GitHubAppInstallGuide } from "../GitHubAppInstallGuide";
import { useEffect, useState } from "react";

interface McpGitHubCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpGitHubCard.Name = "GitHub";
McpGitHubCard.Id = "f12980ac-f80c-47e0-b4ac-181a54122d61";

export function McpGitHubCard({ config, onChange, healthInfo, onTools, viewMode }: McpGitHubCardProps) {
  const [appInstallUrl, setAppInstallUrl] = useState<string>("");

  useEffect(() => {
    if (config?.enabled && !appInstallUrl) {
      const loadGitHubInstallUrl = async () => {
        try {
          const installUrl = await ipcClient.githubToken.getInstallUrl();
          setAppInstallUrl(installUrl);
        } catch (e) {
          console.error("Failed to load GitHub install URL:", e);
        }
      };
      void loadGitHubInstallUrl();
    }
  }, [config?.enabled, appInstallUrl]);

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
    <>
      <GitHubAppInstallGuide appInstallUrl={appInstallUrl} />
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
    </>
  );
}
