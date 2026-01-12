import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { HealthStatusInfo } from "@/types";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../../services/ipc-client";
import { HealthStatus } from "../../health-status/health-status";
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
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";
import { McpWhitelistDialog } from "./McpWhitelistDialog";
import { Globe } from "lucide-react";
import { McpCard } from "./mcp-card";
import { McpGitHubCard } from "./github/mcp-github-card";
import { McpServerFormCard } from "./mcp-server-form-card";


type ServerHealthStatus<T extends string = string> = Record<T, HealthStatusInfo>;

interface McpSettingsPanelProps {
  isActive?: boolean;
  onFormOpenChange?: (isOpen: boolean) => void;
  onHasEnabledServers?: (hasEnabled: boolean) => void;
  includeBuiltin?: boolean;
}

export function McpSettingsPanel({
  isActive = true,
  onFormOpenChange,
  onHasEnabledServers,
  includeBuiltin = true,
}: McpSettingsPanelProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddCustomMcpForm, setShowAddCustomMcpForm] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<ServerHealthStatus<string>>({});
  const [whitelistServer, setWhitelistServer] = useState<MCPServerConfig | null>(null);
  const [appInstallUrl, setAppInstallUrl] = useState<string>("");

  // Load GitHub install URL
  useEffect(() => {
    if (isActive && !appInstallUrl) {
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
  }, [isActive, appInstallUrl]);

  useEffect(() => {
    const hasEnabled = servers.some(
      (server) => (includeBuiltin || !server.builtin) && server.enabled !== false,
    );
    onHasEnabledServers?.(hasEnabled);
  }, [servers, onHasEnabledServers, includeBuiltin]);

  const checkAllServersHealth = useCallback(async (serverList: MCPServerConfig[]) => {
    const initialStatus: ServerHealthStatus<string> = {};
    serverList.forEach((server) => {
      if (server.enabled !== false) {
        initialStatus[server.id ?? server.name] = { isHealthy: false, isChecking: true };
      } else {
        initialStatus[server.id ?? server.name] = {
          isHealthy: false,
          isChecking: false,
          successMessage: "Disabled",
        };
      }
    });
    setHealthStatus(initialStatus);

    for (const server of serverList) {
      if (server.enabled === false) continue;
      try {
        const result = (await ipcClient.mcp.checkServerHealthAsync(
          server.id ?? server.name,
        )) as HealthStatusInfo;
        setHealthStatus((prev) => ({
          ...prev,
          [server.id ?? server.name]: { ...result, isChecking: false },
        }));
      } catch (e) {
        setHealthStatus((prev) => ({
          ...prev,
          [server.id ?? server.name]: {
            isHealthy: false,
            error: formatErrorMessage(e),
            isChecking: false,
          },
        }));
      }
    }
  }, []);

  const loadServers = useCallback(
    async (includeBuiltin: boolean = false) => {
      setIsLoading(true);
      try {
        const list = await ipcClient.mcp.listServers();
        const filteredList = includeBuiltin ? list : list.filter((server) => !server.builtin);
        setServers(filteredList);
        await checkAllServersHealth(filteredList);
      } catch (e) {
        toast.error(`Failed to load servers: ${formatErrorMessage(e)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [checkAllServersHealth],
  );

  useEffect(() => {
    if (isActive) {
      void loadServers();
    }
  }, [isActive, loadServers]);

  // const showForm = useCallback(
  //   (server?: MCPServerConfig | null) => {
  //     setViewMode(server ? "edit" : "add");
  //     setEditingServer(server ?? null);
  //     onFormOpenChange?.(true);
  //   },
  //   [onFormOpenChange]
  // );

  // const showList = useCallback(() => {
  //   setViewMode("list");
  //   setEditingServer(null);
  //   onFormOpenChange?.(false);
  // }, [onFormOpenChange]);

  // const showList = useCallback(() => {
  //   setViewMode("list");
  //   setEditingServer(null);
  // }, []);

  // const handleSubmit = useCallback(
  //   async (config: MCPServerConfig) => {
  //     setIsLoading(true);
  //     try {
  //       if (viewMode === "add") {
  //         await ipcClient.mcp.addServerAsync(config);
  //         toast.success(`Server '${config.name}' added`);
  //       } else if (viewMode === "edit" && editingServer) {
  //         await ipcClient.mcp.updateServerAsync(editingServer.id ?? editingServer.name, config);
  //         toast.success(`Server '${config.name}' updated`);
  //       }
  //       showList();
  //       await loadServers();
  //     } catch (e) {
  //       toast.error(`Failed to save: ${formatErrorMessage(e)}`);
  //     } finally {
  //       setIsLoading(false);
  //     }
  //   },
  //   [viewMode, editingServer, showList, loadServers],
  // );

  const confirmDeleteServer = useCallback((serverIdOrName: string) => {
    setServerToDelete(serverIdOrName);
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
      await ipcClient.mcp.removeServerAsync(serverToDelete);
      toast.success(`Server '${serverToDelete}' removed`);
      await loadServers();
    } catch (e) {
      toast.error(`Failed to remove: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
      setServerToDelete(null);
    }
  }, [serverToDelete, loadServers]);

  const handleToggleEnabled = useCallback(
    async (server: MCPServerConfig, enabled: boolean) => {
      try {
        const updatedServer = { ...server, enabled };
        await ipcClient.mcp.updateServerAsync(server.name, updatedServer);

        // Optimistic update
        setServers((prev) => prev.map((s) => (s.name === server.name ? updatedServer : s)));

        toast.success(`Server '${server.name}' ${enabled ? "enabled" : "disabled"}`);

        // Reload to ensure sync and re-check health if enabled
        await loadServers();
      } catch (e) {
        toast.error(`Failed to update server: ${formatErrorMessage(e)}`);
        // Revert on error
        await loadServers();
      }
    },
    [loadServers],
  );

  async function toggleSettings(
    serverName: string,
    status: boolean,
    configLocal: MCPServerConfig,
  ): Promise<void> {
    const updatedConfig = { ...configLocal, enabled: status };
    await ipcClient.mcp.updateServerAsync(serverName, updatedConfig);
  }

  async function handleSubmit(config: MCPServerConfig): Promise<void> {
    console.log("Submitting MCP server config:", config, editingServer);
    setIsLoading(true);
    try {
      if (editingServer) {
        console.log("Updating server:", editingServer.name, "with config:", config);
        await ipcClient.mcp.updateServerAsync(editingServer.name, config);
        toast.success(`Server '${config.name}' updated`);

        await loadServers();
      } else {
        console.warn("Editing server is null, cannot submit.");
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

  function handleOnConnect(serverName: string, configLocal: MCPServerConfig): void {
    toggleSettings(serverName, true, configLocal);
  }
  function handleOnDisconnect(serverName: string, configLocal: MCPServerConfig): void {
    toggleSettings(serverName, false, configLocal);
  }

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => a.name.localeCompare(b.name));
  }, [servers]);

  const github: MCPServerConfig | undefined = sortedServers.find(
    (server) => server.name === McpGitHubCard.Name,
  );
  const restServers: MCPServerConfig[] = sortedServers.filter(
    (server) => server.name !== McpGitHubCard.Name,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <pre>{JSON.stringify(servers, null, 2)}</pre>
      <div className="grid grid-cols-1 gap-4 mb-4">
        <McpGitHubCard config={github} onChange={() => loadServers()} />
        {restServers.map((server) => (
          <McpCard
            key={server.name}
            onDelete={() => confirmDeleteServer(server.name)}
            icon={<Globe />}
            config={server}
            onConnect={() => handleOnConnect(server.name, server)}
            onDisconnect={() => handleOnDisconnect(server.name, server)}
            onUpdate={async (newConfig) => {
              setEditingServer(server);
              console.log("Updating server:", server.name, "with config:", newConfig);
              // await handleSubmit(newConfig);
            }}
          />
        ))}
      </div>
      {!showAddCustomMcpForm && (
        <div className="flex flex-col items-center mb-4">
          <span className="font-light text-sm my-4">OR</span>
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
          setWhitelistServer(null);
          await loadServers();
        }}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {serverToDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove server '{serverToDelete}'? This action cannot be
              undone.
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
