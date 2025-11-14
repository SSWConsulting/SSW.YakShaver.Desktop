import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { HealthStatusInfo, McpAiMode, McpToolControlSettings } from "@/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";

type ViewMode = "list" | "add" | "edit";

type ServerHealthStatus<T extends string = string> = Record<T, HealthStatusInfo>;

interface McpSettingsPanelProps {
  isActive: boolean;
}

const AI_MODE_OPTIONS: Array<{
  value: McpAiMode;
  label: string;
  description: string;
}> = [
  {
    value: "yolo",
    label: "YOLO",
    description: "Run all tools automatically. No prompts or warnings.",
  },
  {
    value: "warn",
    label: "Warn",
    description: "Show a prompt and auto-accept after 15 seconds if you do nothing.",
  },
  {
    value: "ask_first",
    label: "Ask First",
    description: "Always require manual approval before running each tool.",
  },
];

export function McpSettingsPanel({ isActive }: McpSettingsPanelProps) {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<ServerHealthStatus<string>>({});
  const [toolSettings, setToolSettings] = useState<McpToolControlSettings | null>(null);
  const [isToolSettingsLoading, setIsToolSettingsLoading] = useState(false);

  const checkAllServersHealth = useCallback(async (serverList: MCPServerConfig[]) => {
    const initialStatus: ServerHealthStatus<string> = {};
    serverList.forEach((server) => {
      initialStatus[server.name] = { isHealthy: false, isChecking: true };
    });
    setHealthStatus(initialStatus);

    for (const server of serverList) {
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

  const loadToolSettings = useCallback(async () => {
    setIsToolSettingsLoading(true);
    try {
      const settings = await ipcClient.mcp.getToolControlSettings();
      setToolSettings(settings);
    } catch (e) {
      toast.error(`Failed to load tool controls: ${formatErrorMessage(e)}`);
    } finally {
      setIsToolSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void loadServers();
      void loadToolSettings();
    }
  }, [isActive, loadServers, loadToolSettings]);

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

  const handleModeChange = useCallback(
    async (mode: McpAiMode) => {
      setIsToolSettingsLoading(true);
      try {
        const updated = await ipcClient.mcp.setToolControlMode(mode);
        setToolSettings(updated);
        const label = AI_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? mode;
        toast.success(`AI mode set to ${label}`);
      } catch (e) {
        toast.error(`Failed to update mode: ${formatErrorMessage(e)}`);
      } finally {
        setIsToolSettingsLoading(false);
      }
    },
    [],
  );

  const handleRemoveWhitelist = useCallback(async (id: string) => {
    setIsToolSettingsLoading(true);
    try {
      const updated = await ipcClient.mcp.removeWhitelistedTool(id);
      setToolSettings(updated);
      toast.success("Removed tool from whitelist");
    } catch (e) {
      toast.error(`Failed to update whitelist: ${formatErrorMessage(e)}`);
    } finally {
      setIsToolSettingsLoading(false);
    }
  }, []);

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
              <Card className="bg-black/40 border-white/15">
                <CardContent className="space-y-4 p-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white">AI Tool Control Mode</h3>
                    <p className="text-sm text-white/70">
                      Decide how YakShaver uses MCP tools during automations.
                    </p>
                  </div>
                  <Select
                    value={toolSettings?.mode ?? "warn"}
                    onValueChange={(value) => handleModeChange(value as McpAiMode)}
                    disabled={isToolSettingsLoading}
                  >
                    <SelectTrigger className="w-full max-w-sm bg-black/40 border-white/20 text-white">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-900 text-white border-white/20">
                      {AI_MODE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-white">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid gap-3 md:grid-cols-3">
                    {AI_MODE_OPTIONS.map((option) => (
                      <div
                        key={option.value}
                        className={`rounded-lg border p-3 text-sm ${
                          toolSettings?.mode === option.value
                            ? "border-white/60 bg-white/10"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <p className="font-semibold text-white">{option.label}</p>
                        <p className="text-white/70">{option.description}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/15">
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Tool Whitelist</h3>
                      <p className="text-sm text-white/70">
                        Tools listed here always run immediately, regardless of AI mode.
                      </p>
                    </div>
                    {isToolSettingsLoading && (
                      <span className="text-sm text-white/60">Updating…</span>
                    )}
                  </div>
                  {toolSettings?.whitelist?.length ? (
                    <div className="space-y-3">
                      {toolSettings.whitelist.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-col gap-2 rounded-lg border border-white/15 bg-white/5 p-4 text-white sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="font-semibold">{entry.toolName}</p>
                            <p className="text-sm text-white/70">Server: {entry.serverName}</p>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isToolSettingsLoading}
                            onClick={() => handleRemoveWhitelist(entry.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty className="bg-transparent border border-dashed border-white/20">
                      <EmptyHeader>
                        <EmptyTitle>No whitelisted tools yet</EmptyTitle>
                        <EmptyDescription>
                          Approve a tool with "Always accept" or change settings here later.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button variant="secondary" onClick={showAddForm} size="lg" disabled={isLoading}>
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
                                />
                              </div>

                              <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white">{server.name}</h3>
                                <p className="mt-2 break-all font-mono text-sm text-white/50">
                                  {server.url}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
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
        <AlertDialogContent className="bg-neutral-900 text-neutral-100 border-neutral-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete {serverToDelete}</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70 text-base pt-2">
              Are you sure you want to remove server '{serverToDelete}'? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-800 text-white hover:bg-neutral-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isLoading}
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
