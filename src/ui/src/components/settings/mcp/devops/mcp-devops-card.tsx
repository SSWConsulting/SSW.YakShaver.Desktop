import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { useMcpCardActions } from "@/hooks/useMcpCardActions";
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

McpAzureDevOpsCard.Name = "Azure_DevOps";
McpAzureDevOpsCard.Id = PRESET_SERVER_IDS.AZURE_DEVOPS;

export function McpAzureDevOpsCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpDevOpsCardProps) {
  const configLocal = config ?? {
    id: McpAzureDevOpsCard.Id,
    name: "Azure_DevOps", // quick fix for MCP name can't have space.
    transport: "stdio",
    command: "npx",
    //TODO: need to be able to customize this last parameter
    // https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/547
    args: ["-y", "@azure-devops/mcp", "ssw2"],

    description: "Azure DevOps MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  const { handleOnConnect, handleOnDisconnect } = useMcpCardActions(
    McpAzureDevOpsCard.Id,
    configLocal,
    onChange,
  );

  return (
    <McpCard
      icon={<AzureDevOpsIcon />}
      config={configLocal}
      healthInfo={healthInfo}
      onConnect={handleOnConnect}
      onDisconnect={handleOnDisconnect}
      onTools={onTools}
      viewMode={viewMode}
      hideDelete={true}
    />
  );
}
