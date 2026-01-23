import { ipcClient } from "@/services/ipc-client";
import type { HealthStatusInfo } from "../../../../../../backend/types";
import type { MCPServerConfig } from "../McpServerForm";
import { McpCard } from "../mcp-card";
import { AzureDevOpsIcon } from "./devops-icon";

interface McpDevOpsCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpAzureDevOpsCard.Name = "Azure DevOps";
McpAzureDevOpsCard.Id = "483d49a4-0902-415a-a987-832a21bd3d63";

export function McpAzureDevOpsCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpDevOpsCardProps) {
  const configLocal = config ?? {
    id: McpAzureDevOpsCard.Id,
    name: McpAzureDevOpsCard.Name,
    transport: "stdio",
    command: "npx",
    //TODO: need to be able to customize this last parameter
    // https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/547
    args: ["-y", "@azure-devops/mcp", "ssw2"],

    description: "Azure DevOps MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  async function toggleSettings(status: boolean): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    console.log("Updating Azure DevOps MCP config:", updatedConfig, McpAzureDevOpsCard.Id);
    await ipcClient.mcp.updateServerAsync(McpAzureDevOpsCard.Id, updatedConfig);

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
      icon={<AzureDevOpsIcon />}
      config={configLocal}
      healthInfo={healthInfo}
      onConnect={handleOnConnect}
      onDisconnect={handleOnDisconnect}
      onTools={onTools}
      viewMode={viewMode}
    />
  );
}
