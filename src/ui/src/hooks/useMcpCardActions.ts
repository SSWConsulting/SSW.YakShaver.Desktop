import { toast } from "sonner";
import type { MCPServerConfig } from "@/components/settings/mcp/McpServerForm";
import { ipcClient } from "@/services/ipc-client";
import { formatIpcErrorMessage } from "@/utils";

/**
 * Reauthorize an MCP server, then refresh its health regardless of outcome so a
 * failed re-auth stays visible on the card. Shared by the built-in cards (via
 * this hook) and the generic user-server card, which only differ in how they
 * refresh (`refresh`) (#982).
 */
export async function reauthorizeAndRefresh(
  serverId: string,
  refresh: () => void | Promise<void>,
): Promise<void> {
  try {
    await ipcClient.mcp.reauthorizeAsync(serverId);
  } catch (error) {
    toast.error(`Failed to reauthorize: ${formatIpcErrorMessage(error)}`);
  } finally {
    await refresh();
  }
}

export function useMcpCardActions(
  serverId: string,
  configLocal: MCPServerConfig,
  onChange?: (config: MCPServerConfig) => void,
) {
  async function toggleSettings(status: boolean): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    await ipcClient.mcp.updateServerAsync(serverId, updatedConfig);
    if (onChange) {
      onChange(updatedConfig);
    }
  }

  async function handleOnConnect(): Promise<void> {
    try {
      await toggleSettings(true);
    } catch (error) {
      toast.error(`Failed to connect: ${formatIpcErrorMessage(error)}`);
    }
  }

  async function handleOnDisconnect(): Promise<void> {
    await ipcClient.mcp.clearTokensAsync(serverId);
    await toggleSettings(false);
  }

  async function handleOnReauthorize(): Promise<void> {
    await reauthorizeAndRefresh(serverId, () => onChange?.({ ...configLocal }));
  }

  return { toggleSettings, handleOnConnect, handleOnDisconnect, handleOnReauthorize };
}
