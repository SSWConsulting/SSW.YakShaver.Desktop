import { Globe } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { HealthStatusInfo } from "@/types";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../../services/ipc-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { McpAzureDevOpsCard } from "./devops/mcp-devops-card";
import { McpGitHubCard } from "./github/mcp-github-card";
import type { MCPServerConfig } from "./McpServerForm";
import { McpWhitelistDialog } from "./McpWhitelistDialog";
import { McpCard } from "./mcp-card";
import { McpServerFormCard } from "./mcp-server-form-card";

type ServerHealthStatus<T extends string = string> = Record<T, HealthStatusInfo>;

interface McpSettingsPanelProps {
  isActive?: boolean;
  onFormOpenChange?: (isOpen: boolean) => void;
  onHasEnabledServers?: (hasEnabled: boolean) => void;
  includeBuiltin?: boolean;
  viewMode: "compact" | "detailed";
}

export function McpSettingsPanel({
  isActive = true,
  onHasEnabledServers,
  includeBuiltin = true,
  viewMode = "compact",
}: McpSettingsPanelProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddCustomMcpForm, setShowAddCustomMcpForm] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<{
    serverId: string;
    serverName: string;
  } | null>(null);
  const [healthStatus, setHealthStatus] = useState<ServerHealthStatus<string>>({});
  const [whitelistServer, setWhitelistServer] = useState<MCPServerConfig | null>(null);

  useEffect(() => {
    const hasEnabled = servers.some(
      (server) => (includeBuiltin || !server.builtin) && server.enabled !== false,
    );
    onHasEnabledServers?.(hasEnabled);
  }, [servers, onHasEnabledServers, includeBuiltin]);

  const checkSingleServerHealth = useCallback(async (server: MCPServerConfig) => {
    if (!server.id) return;

    if (server.enabled === false) {
      setHealthStatus((prev) => ({
        ...prev,
        [server.id as string]: {
          isHealthy: false,
          isChecking: false,
          successMessage: "Disabled",
        },
      }));
      return;
    }

    setHealthStatus((prev) => ({
      ...prev,
      [server.id as string]: { isHealthy: false, isChecking: true },
    }));

    try {
      const result = (await ipcClient.mcp.checkServerHealthAsync(server.id)) as HealthStatusInfo;
      setHealthStatus((prev) => ({
        ...prev,
        [server.id as string]: { ...result, isChecking: false },
      }));
    } catch (e) {
      setHealthStatus((prev) => ({
        ...prev,
        [server.id as string]: {
          isHealthy: false,
          error: formatErrorMessage(e),
          isChecking: false,
        },
      }));
    }
  }, []);

  const checkAllServersHealth = useCallback(
    async (serverList: MCPServerConfig[]) => {
      setHealthStatus((prev) => {
        const initialStatus: ServerHealthStatus<string> = { ...prev };
        serverList.forEach((server) => {
          if (!server.id) return;
          if (server.enabled !== false) {
            initialStatus[server.id] = { isHealthy: false, isChecking: true };
          } else {
            initialStatus[server.id] = {
              isHealthy: false,
              isChecking: false,
              successMessage: "Disabled",
            };
          }
        });

        return initialStatus;
      });

      for (const server of serverList) {
        if (server.enabled === false || !server.id) continue;
        await checkSingleServerHealth(server);
      }
    },
    [checkSingleServerHealth],
  );

  const loadServers = useCallback(
    async (options?: {
      includeBuiltin?: boolean;
      serverIdToRefresh?: string;
      skipHealthCheck?: boolean;
    }) => {
      setIsLoading(true);
      try {
        const list = await ipcClient.mcp.listServers();
        const filteredList = options?.includeBuiltin
          ? list
          : list.filter((server) => !server.builtin);
        setServers(filteredList);

        if (options?.serverIdToRefresh) {
          const server = filteredList.find((s) => s.id === options.serverIdToRefresh);
          if (server) {
            await checkSingleServerHealth(server);
          }
        } else if (!options?.skipHealthCheck) {
          await checkAllServersHealth(filteredList);
        }
      } catch (e) {
        toast.error(`Failed to load servers: ${formatErrorMessage(e)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [checkAllServersHealth, checkSingleServerHealth],
  );

  useEffect(() => {
    if (isActive) {
      void loadServers();
    }
  }, [isActive, loadServers]);

  const confirmDeleteServer = useCallback((serverId: string, serverName: string) => {
    setServerToDelete({ serverId, serverName });
    setDeleteConfirmOpen(true);
  }, []);

  const openWhitelistDialog = useCallback((server: MCPServerConfig) => {
    if (server.builtin) return;
    setWhitelistServer(server);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!serverToDelete) return;

    setIsLoading(true);
    setDeleteConfirmOpen(false);

    try {
      await ipcClient.mcp.removeServerAsync(serverToDelete.serverId);
      toast.success(`Server '${serverToDelete.serverName}' removed`);
      await loadServers({ skipHealthCheck: true });
    } catch (e) {
      toast.error(`Failed to remove: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
      setServerToDelete(null);
    }
  }, [serverToDelete, loadServers]);

  async function toggleSettings(
    serverId: string,
    status: boolean,
    configLocal: MCPServerConfig,
  ): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    await ipcClient.mcp.updateServerAsync(serverId, updatedConfig);
    await loadServers({ serverIdToRefresh: serverId });
  }

  async function handleSubmit(config: MCPServerConfig): Promise<void> {
    setIsLoading(true);
    try {
      if (config.id) {
        await ipcClient.mcp.updateServerAsync(config.id, config);
        toast.success(`Server '${config.name}' updated`);
        setShowAddCustomMcpForm(false);
        setEditingServer(null);
        await loadServers({ serverIdToRefresh: config.id });
      } else {
        const result = await ipcClient.mcp.addServerAsync(config);
        toast.success(`Server '${config.name}' added`);
        setShowAddCustomMcpForm(false);
        setEditingServer(null);
        await loadServers({ serverIdToRefresh: result.data?.id ?? undefined });
      }
    } catch (e) {
      toast.error(`Failed to save: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }

    return Promise.resolve();
  }

  function handleCancel(): void {
    setShowAddCustomMcpForm(false);
    setEditingServer(null);
  }

  async function handleOnConnect(serverId: string, configLocal: MCPServerConfig): Promise<void> {
    await toggleSettings(serverId, true, configLocal);
  }

  async function handleOnDisconnect(serverId: string, configLocal: MCPServerConfig): Promise<void> {
    await toggleSettings(serverId, false, configLocal);
  }

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => a.name.localeCompare(b.name));
  }, [servers]);

  const github: MCPServerConfig | undefined = sortedServers.find(
    (server) => server.id === McpGitHubCard.Id,
  );
  const azureDevOps: MCPServerConfig | undefined = sortedServers.find(
    (s) => s.id === McpAzureDevOpsCard.Id,
  );

  const restServers: MCPServerConfig[] = sortedServers.filter(
    (server) => server.id !== McpGitHubCard.Id && server.id !== McpAzureDevOpsCard.Id,
  );

  function getHealthStatus(serverId?: string | null): HealthStatusInfo | null {
    if (!serverId) return null;

    return healthStatus[serverId] || null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid grid-cols-1 gap-4 mb-4">
        <McpGitHubCard
          config={github}
          onChange={() => loadServers({ serverIdToRefresh: McpGitHubCard.Id })}
          healthInfo={getHealthStatus(github?.id)}
          onTools={() => github && openWhitelistDialog(github)}
          viewMode={viewMode}
        />
        <McpAzureDevOpsCard
          config={azureDevOps}
          onChange={() => loadServers({ serverIdToRefresh: McpAzureDevOpsCard.Id })}
          healthInfo={getHealthStatus(McpAzureDevOpsCard.Id)}
          onTools={() => azureDevOps && openWhitelistDialog(azureDevOps)}
          viewMode={viewMode}
        />
        {restServers.map((server) => (
          <>
            <McpCard
              key={server.id}
              onDelete={() => confirmDeleteServer(String(server.id), server.name)}
              healthInfo={getHealthStatus(server.id)}
              icon={<Globe />}
              config={server}
              onTools={() => openWhitelistDialog(server)}
              onConnect={() => handleOnConnect(String(server.id), server)}
              onDisconnect={() => handleOnDisconnect(String(server.id), server)}
              onUpdate={async (newConfig) => {
                setEditingServer(server);
                await handleSubmit(newConfig);
              }}
              viewMode={viewMode}
            />
          </>
        ))}
      </div>
      {!showAddCustomMcpForm && (
        <div className="flex flex-col items-center mb-4">
          <span className="font-light text-sm my-4">OR</span>
          {/* biome-ignore lint : lint message can be ignored for now as we don't support fully keyboard navigation and waiting for new designs */}
          <div
            className={`w-full max-w-xl cursor-pointer mt-2 flex items-center justify-center rounded-lg border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)] py-4 px-6 opacity-100 text-base font-medium text-center select-none transition hover:bg-[rgba(255,255,255,0.08)]`}
            onClick={() => {
              setShowAddCustomMcpForm(true);
            }}
          >
            + Add custom MCP
          </div>
        </div>
      )}

      {showAddCustomMcpForm && (
        <McpServerFormCard
          initialData={editingServer ?? null}
          viewMode={"add"}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isLoading={isLoading}
          servers={servers}
        />
      )}

      <McpWhitelistDialog
        server={whitelistServer}
        onClose={() => setWhitelistServer(null)}
        onSaved={async () => {
          const serverId = whitelistServer?.id;
          setWhitelistServer(null);
          if (serverId) {
            await loadServers({ serverIdToRefresh: serverId });
          } else {
            await loadServers();
          }
        }}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {serverToDelete?.serverName}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove server '{serverToDelete?.serverName}'? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Delete Server</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
