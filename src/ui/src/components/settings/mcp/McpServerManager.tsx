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
import { Switch } from "../../ui/switch";
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";

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

  const checkAllServersHealth = useCallback(async (serverList: MCPServerConfig[]) => {
    const initialStatus: ServerHealthStatus<string> = {};
    serverList.forEach((server) => {
      if (server.enabled === false) {
        initialStatus[server.name] = {
          isHealthy: false,
          isChecking: false,
          disabled: true,
          error: "Disabled",
        };
        return;
      }
      initialStatus[server.name] = { isHealthy: false, isChecking: true };
    });
    setHealthStatus(initialStatus);

    for (const server of serverList.filter((s) => s.enabled)) {
      try {
        const result = (await ipcClient.mcp.checkServerHealth(server.name)) as HealthStatusInfo;
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
          await ipcClient.mcp.addServer(config);
          toast.success(`Server '${config.name}' added`);
        } else if (viewMode === "edit" && editingServer) {
          await ipcClient.mcp.updateServer(editingServer.name, config);
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

  const toggleServerEnabled = useCallback(
    async (server: MCPServerConfig, enabled: boolean) => {
      setIsLoading(true);
      try {
        await ipcClient.mcp.updateServer(server.name, { ...server, enabled });
        toast.success(`Server '${server.name}' ${enabled ? "enabled" : "disabled"}`);
        await loadServers();
      } catch (e) {
        toast.error(
          `Failed to ${enabled ? "enable" : "disable"} '${server.name}': ${formatErrorMessage(e)}`,
        );
      } finally {
        setIsLoading(false);
      }
    },
    [loadServers],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!serverToDelete) return;

    setIsLoading(true);
    setDeleteConfirmOpen(false);

    try {
      await ipcClient.mcp.removeServer(serverToDelete);
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
        <h2 className="text-white text-xl font-semibold">MCP Server Settings</h2>
        <p className="text-white/70 text-sm">
          Manage external MCP servers and monitor their health status.
        </p>
      </header>
      <ScrollArea className="flex-1 pr-1">
        <div className="flex flex-col gap-6 pb-6 pr-2">
          {viewMode === "list" && (
            <div className="flex flex-col gap-6">
              <div className="flex justify-end">
                <Button onClick={showAddForm} size="lg" disabled={isLoading}>
                  Add Server
                </Button>
              </div>

              {servers.length === 0 && (
                <Empty className="bg-black/20">
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
                    const detailText =
                      server.transport === "streamableHttp"
                        ? (server.url ?? "")
                        : server.command && server.command.trim()
                          ? [server.command, ...(server.args ?? [])]
                              .filter((part) => !!part?.trim())
                              .join(" ")
                          : "No command specified";
                    const isEnabled = server.enabled !== false;
                    return (
                      <Card
                        key={server.name}
                        className="bg-black/40 border-white/20 hover:border-white/40 transition-colors"
                      >
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex flex-1 items-start gap-3">
                              <div className="group relative mt-1 flex-shrink-0">
                                <HealthStatus
                                  isHealthy={!!status.isHealthy}
                                  isChecking={!!status.isChecking}
                                  successMessage={status.successMessage}
                                  error={status.error}
                                  disabled={!!status.disabled}
                                />
                              </div>

                              <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white">{server.name}</h3>
                                <p className="mt-2 break-all font-mono text-sm text-white/50">
                                  {detailText || ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs uppercase tracking-wide text-white/60">
                                  {isEnabled ? "Enabled" : "Disabled"}
                                </span>
                                <Switch
                                  checked={isEnabled}
                                  onCheckedChange={(checked: boolean) =>
                                    toggleServerEnabled(server, checked)
                                  }
                                  disabled={isLoading}
                                  aria-label={`Toggle server ${server.name}`}
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => showEditForm(server)}
                                  disabled={isLoading}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => confirmDeleteServer(server.name)}
                                  disabled={isLoading}
                                >
                                  Delete
                                </Button>
                              </div>
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
            <AlertDialogDescription className="text-base pt-2">
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
    </div>
  );
}
