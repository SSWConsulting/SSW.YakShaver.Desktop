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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../ui/empty";
import { ScrollArea } from "../../ui/scroll-area";
import { GitHubAppInstallGuide } from "../github-token/GitHubAppInstallGuide";
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";
import { McpWhitelistDialog } from "./McpWhitelistDialog";

type ViewMode = "list" | "add" | "edit";

type ServerHealthStatus<T extends string = string> = Record<T, HealthStatusInfo>;

interface McpSettingsPanelProps {
  isActive: boolean;
}

export function McpSettingsPanel({ isActive }: McpSettingsPanelProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<ServerHealthStatus<string>>({});
  const [whitelistServer, setWhitelistServer] = useState<MCPServerConfig | null>(null);
  const [appInstallUrl, setAppInstallUrl] = useState<string>("");

  // Check if any server is a GitHub MCP server
  const hasGitHubServer = useMemo(() => {
    return servers.some((server) => {
      if (server.transport === "streamableHttp" && server.url) {
        return server.url.includes("github");
      }
      return false;
    });
  }, [servers]);

  // Load GitHub install URL
  useEffect(() => {
    if (isActive && hasGitHubServer) {
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
  }, [isActive, hasGitHubServer]);

  const checkAllServersHealth = useCallback(async (serverList: MCPServerConfig[]) => {
    const initialStatus: ServerHealthStatus<string> = {};
    serverList.forEach((server) => {
      initialStatus[server.name] = { isHealthy: false, isChecking: true };
    });
    setHealthStatus(initialStatus);

    for (const server of serverList) {
      try {
        const result = (await ipcClient.mcp.checkServerHealthAsync(
          server.name,
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
  }, []);

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

  const showAddForm = useCallback(() => {
    setViewMode("add");
    setEditingServer(null);
  }, []);

  const showEditForm = useCallback((server: MCPServerConfig) => {
    setViewMode("edit");
    setEditingServer(server);
  }, []);

  const showList = useCallback(() => {
    setViewMode("list");
    setEditingServer(null);
  }, []);

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
    [viewMode, editingServer, showList, loadServers],
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
              {hasGitHubServer && appInstallUrl && (
                <GitHubAppInstallGuide appInstallUrl={appInstallUrl}/>
              )}

              <div className="flex justify-end">
                <Button onClick={showAddForm} size="lg" disabled={isLoading}>
                  Add Server
                </Button>
              </div>

              {servers.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No MCP servers configured</EmptyTitle>
                    <EmptyDescription>
                      You don't have any MCP servers configured. Click "Add Server" to configure
                      one.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              {servers.length > 0 && (
                <div className="flex flex-col gap-4">
                  {sortedServers.map((server) => {
                    const status = healthStatus[server.name] || {};
                    const transportLabel = server.transport === "streamableHttp" ? "http" : "stdio";
                    const connectionSummary =
                      server.transport === "streamableHttp"
                        ? (server.url ?? "")
                        : "command" in server
                          ? [server.command, ...(server.args ?? [])]
                              .filter((part) => part && part.length > 0)
                              .join(" ")
                          : "";
                    const cwdSummary =
                      server.transport === "stdio" && "cwd" in server ? server.cwd : undefined;

                    return (
                      <Card key={server.name}>
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex flex-1 items-start gap-3">
                              <div className="group relative mt-1 flex-shrink-0">
                                <HealthStatus
                                  isHealthy={!!status.isHealthy}
                                  isChecking={!!status.isChecking}
                                  successMessage={status.successMessage}
                                  error={status.error}
                                />
                              </div>

                              <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white">{server.name}</h3>
                                {server.builtin ? (
                                  <p className="mt-2 text-sm text-white/50">Built-in MCP Server</p>
                                ) : (
                                  <p className="mt-1 text-xs uppercase tracking-wide text-white/40">
                                    {transportLabel}
                                  </p>
                                )}
                                {server.description && (
                                  <p className="mt-1 text-sm text-white/70">{server.description}</p>
                                )}
                                <p className="mt-2 break-all font-mono text-sm text-white/50">
                                  {server.builtin ? "" : connectionSummary || "—"}
                                </p>
                                {cwdSummary && (
                                  <p className="mt-1 text-xs text-white/40">
                                    cwd: <span className="font-mono">{cwdSummary}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => showEditForm(server)}
                                disabled={isLoading || server.builtin}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => openWhitelistDialog(server)}
                                disabled={isLoading || server.builtin}
                              >
                                Configure Whitelist
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => confirmDeleteServer(server.name)}
                                disabled={isLoading || server.builtin}
                              >
                                Delete
                              </Button>
                            </div>
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
            />
          )}
        </div>
      </ScrollArea>

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
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={isLoading}>
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
