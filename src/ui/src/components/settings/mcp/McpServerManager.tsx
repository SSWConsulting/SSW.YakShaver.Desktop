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
import { Button } from "../../ui/button";
import { Card, CardContent } from "../../ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../../ui/empty";
import { ScrollArea } from "../../ui/scroll-area";
import { Switch } from "../../ui/switch";
import { GitHubAppInstallGuide } from "./GitHubAppInstallGuide";
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";
import { McpWhitelistDialog } from "./McpWhitelistDialog";

type ViewMode = "list" | "add" | "edit";

type ServerHealthStatus<T extends string = string> = Record<
  T,
  HealthStatusInfo
>;

interface McpSettingsPanelProps {
  isActive?: boolean;
  onFormOpen?: (isOpen: boolean) => void;
}

export function McpSettingsPanel({
  isActive = true,
  onFormOpen,
}: McpSettingsPanelProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(
    null
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<ServerHealthStatus<string>>(
    {}
  );
  const [whitelistServer, setWhitelistServer] =
    useState<MCPServerConfig | null>(null);
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

  const checkAllServersHealth = useCallback(
    async (serverList: MCPServerConfig[]) => {
      const initialStatus: ServerHealthStatus<string> = {};
      serverList.forEach((server) => {
        if (server.enabled !== false) {
          initialStatus[server.name] = { isHealthy: false, isChecking: true };
        } else {
          initialStatus[server.name] = {
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
            server.name
          )) as HealthStatusInfo;
          setHealthStatus((prev) => ({
            ...prev,
            [server.name]: { ...result, isChecking: false },
          }));
        } catch (e) {
          setHealthStatus((prev) => ({
            ...prev,
            [server.name]: {
              isHealthy: false,
              error: formatErrorMessage(e),
              isChecking: false,
            },
          }));
        }
      }
    },
    []
  );

  const loadServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await ipcClient.mcp.listServers();
      setServers(list);
      await checkAllServersHealth(list);
    } catch (e) {
      toast.error(`Failed to load servers: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [checkAllServersHealth]);

  useEffect(() => {
    if (isActive) {
      void loadServers();
    }
  }, [isActive, loadServers]);

  const showForm = useCallback(
    (server?: MCPServerConfig | null) => {
      setViewMode(server ? "edit" : "add");
      setEditingServer(server ?? null);
      onFormOpen?.(true);
    },
    [onFormOpen]
  );

  const showList = useCallback(() => {
    setViewMode("list");
    setEditingServer(null);
    onFormOpen?.(false);
  }, [onFormOpen]);

  const handleSubmit = useCallback(
    async (config: MCPServerConfig) => {
      setIsLoading(true);
      try {
        if (viewMode === "add") {
          await ipcClient.mcp.addServerAsync(config);
          toast.success(`Server '${config.name}' added`);
        } else if (viewMode === "edit" && editingServer) {
          await ipcClient.mcp.updateServerAsync(editingServer.name, config);
          toast.success(`Server '${config.name}' updated`);
        }
        showList();
        await loadServers();
      } catch (e) {
        toast.error(`Failed to save: ${formatErrorMessage(e)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [viewMode, editingServer, showList, loadServers]
  );

  const confirmDeleteServer = useCallback((name: string) => {
    setServerToDelete(name);
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
        setServers((prev) =>
          prev.map((s) => (s.name === server.name ? updatedServer : s))
        );

        toast.success(
          `Server '${server.name}' ${enabled ? "enabled" : "disabled"}`
        );

        // Reload to ensure sync and re-check health if enabled
        await loadServers();
      } catch (e) {
        toast.error(`Failed to update server: ${formatErrorMessage(e)}`);
        // Revert on error
        await loadServers();
      }
    },
    [loadServers]
  );

  const sortedServers = useMemo(() => {
    return [...servers].sort((a, b) => a.name.localeCompare(b.name));
  }, [servers]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="mb-4 flex flex-col gap-1">
        <h2 className="text-xl font-semibold">MCP Server Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage external MCP servers and monitor their health status.
        </p>
      </header>
      <ScrollArea className="flex-1 pr-1">
        <div className="flex flex-col gap-6 pb-6 pr-2">
          {viewMode === "list" && (
            <div className="flex flex-col gap-6">
              <div className="flex justify-end">
                <Button onClick={() => showForm()} size="lg">
                  Add Server
                </Button>
              </div>

              {servers.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No MCP servers configured</EmptyTitle>
                    <EmptyDescription>
                      You don't have any MCP servers configured. Click "Add
                      Server" to configure one.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              {servers.length > 0 && (
                <div className="flex flex-col gap-4">
                  {sortedServers.map((server) => {
                    const status = healthStatus[server.name] || {};
                    const transportLabel =
                      server.transport === "streamableHttp" ? "http" : "stdio";
                    const connectionSummary =
                      server.transport === "streamableHttp"
                        ? server.url ?? ""
                        : "command" in server
                        ? [server.command, ...(server.args ?? [])]
                            .filter((part) => part && part.length > 0)
                            .join(" ")
                        : "";
                    const cwdSummary =
                      server.transport === "stdio" && "cwd" in server
                        ? server.cwd
                        : undefined;

                    // Check if this is a GitHub MCP server
                    const isGitHubServer =
                      server.transport === "streamableHttp" &&
                      server.url &&
                      server.url.includes("github");

                    return (
                      <Card key={server.name} className="overflow-hidden">
                        <CardContent className="p-6">
                          <div className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-start gap-3">
                                <div className="group relative mt-1 flex-shrink-0">
                                  <HealthStatus
                                    isDisabled={server.enabled === false}
                                    isHealthy={!!status.isHealthy}
                                    isChecking={!!status.isChecking}
                                    successMessage={status.successMessage}
                                    error={status.error}
                                  />
                                </div>

                                <div className="flex-1">
                                  <h3 className="text-lg font-semibold text-white">
                                    {server.name}
                                  </h3>
                                  {server.builtin ? (
                                    <p className="mt-2 text-sm text-white/50">
                                      Built-in MCP Server
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs uppercase tracking-wide text-white/40">
                                      {transportLabel}
                                    </p>
                                  )}
                                  {server.description && (
                                    <p className="mt-1 text-sm text-white/70">
                                      {server.description}
                                    </p>
                                  )}
                                  <p className="mt-2 break-all font-mono text-sm text-white/50">
                                    {server.builtin
                                      ? ""
                                      : connectionSummary || "—"}
                                  </p>
                                  {cwdSummary && (
                                    <p className="mt-1 text-xs text-white/40">
                                      cwd:{" "}
                                      <span className="font-mono">
                                        {cwdSummary}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-start gap-4 flex-shrink-0">
                                <div className="flex items-center gap-2 mt-1">
                                  <Switch
                                    checked={server.enabled !== false}
                                    onCheckedChange={(checked) =>
                                      handleToggleEnabled(server, checked)
                                    }
                                    disabled={server.builtin}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => showForm(server)}
                                    disabled={server.builtin}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => openWhitelistDialog(server)}
                                    disabled={server.builtin}
                                  >
                                    Configure Whitelist
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() =>
                                      confirmDeleteServer(server.name)
                                    }
                                    disabled={server.builtin}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </div>

                            {/* Show GitHub App install guide for GitHub MCP servers */}
                            {isGitHubServer && appInstallUrl && (
                              <GitHubAppInstallGuide
                                appInstallUrl={appInstallUrl}
                              />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {viewMode !== "list" && (
            <McpServerFormWrapper
              initialData={editingServer ?? undefined}
              isEditing={viewMode === "edit"}
              onSubmit={handleSubmit}
              onCancel={showList}
              isLoading={isLoading}
              existingServerNames={servers.map((s) => s.name)}
            />
          )}
        </div>
      </ScrollArea>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {serverToDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove server '{serverToDelete}'? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <McpWhitelistDialog
        server={whitelistServer}
        onClose={() => setWhitelistServer(null)}
        onSaved={async () => {
          setWhitelistServer(null);
          await loadServers();
        }}
      />
    </div>
  );
}
