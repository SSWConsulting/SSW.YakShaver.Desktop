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

  /**
   * #1062: connect with the user's own token (e.g. a GitHub PAT) instead of the backend OAuth,
   * which needs a YakShaver sign-in. Returns whether it was saved so the form can stay open on
   * failure.
   */
  async function handleOnConnectWithToken(token: string): Promise<boolean> {
    const updatedConfig = {
      ...configLocal,
      headers: { ...withoutAuthorizationHeader(configLocal), Authorization: `Bearer ${token}` },
      enabled: true,
    };
    try {
      await ipcClient.mcp.updateServerAsync(serverId, updatedConfig);
      onChange?.(updatedConfig);
      return true;
    } catch (error) {
      toast.error(`Failed to connect: ${formatIpcErrorMessage(error)}`);
      return false;
    }
  }

  /** Disconnects and forgets a user-supplied token, so the next Connect starts fresh. */
  async function handleOnDisconnectAndForgetToken(): Promise<void> {
    const remainingHeaders = withoutAuthorizationHeader(configLocal);
    const updatedConfig = {
      ...configLocal,
      headers: Object.keys(remainingHeaders).length > 0 ? remainingHeaders : undefined,
      enabled: false,
    };
    try {
      await ipcClient.mcp.clearTokensAsync(serverId);
      await ipcClient.mcp.updateServerAsync(serverId, updatedConfig);
      onChange?.(updatedConfig);
    } catch (error) {
      toast.error(`Failed to disconnect: ${formatIpcErrorMessage(error)}`);
    }
  }

  return {
    toggleSettings,
    handleOnConnect,
    handleOnDisconnect,
    handleOnReauthorize,
    handleOnConnectWithToken,
    handleOnDisconnectAndForgetToken,
  };
}

/** True when the server authenticates with a user-supplied `Authorization` header. */
export function hasAuthorizationHeader(config: MCPServerConfig): boolean {
  return Object.entries(getHeaders(config)).some(
    ([name, value]) => name.toLowerCase() === "authorization" && value.trim().length > 0,
  );
}

function getHeaders(config: MCPServerConfig): Record<string, string> {
  return config.transport === "streamableHttp" ? (config.headers ?? {}) : {};
}

function withoutAuthorizationHeader(config: MCPServerConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getHeaders(config)).filter(([name]) => name.toLowerCase() !== "authorization"),
  );
}
