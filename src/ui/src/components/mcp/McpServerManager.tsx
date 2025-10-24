import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { type MCPServerConfig, McpServerForm } from "./McpServerForm";

type ViewMode = "list" | "add" | "edit";

export function McpServerManager() {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const list = await ipcClient.mcp.listServers();
      setServers(list);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load servers: ${errorMessage}`);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  function showAddForm() {
    setViewMode("add");
    setEditingServer(null);
  }

  function showEditForm(server: MCPServerConfig) {
    setViewMode("edit");
    setEditingServer(server);
  }

  function showList() {
    setViewMode("list");
    setEditingServer(null);
  }

  async function handleSubmit(config: MCPServerConfig) {
    setLoading(true);
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
      const errorMessage = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to save: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  function confirmDeleteServer(name: string) {
    setServerToDelete(name);
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!serverToDelete) return;

    setLoading(true);
    setDeleteConfirmOpen(false);

    try {
      await ipcClient.mcp.removeServer(serverToDelete);
      toast.success(`Server '${serverToDelete}' removed`);
      await loadServers();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to remove: ${errorMessage}`);
    } finally {
      setLoading(false);
      setServerToDelete(null);
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">MCP Settings</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton
        className="max-w-5xl max-h-[90vh] overflow-y-auto bg-neutral-900 text-neutral-100 border-neutral-800"
      >
        <DialogHeader>
          <DialogTitle className="text-white text-2xl">MCP Server Settings</DialogTitle>
        </DialogHeader>
        <DialogDescription>View and update your current MCP server settings</DialogDescription>
        <div className="w-full">
          {viewMode === "list" && (
            <div className="flex flex-col gap-6">
              <div className="flex justify-end">
                <Button onClick={showAddForm} size="lg">
                  Add Server
                </Button>
              </div>

              {servers.length === 0 && (
                <p className="text-white/60 text-center py-8">No MCP servers configured</p>
              )}

              {servers.length > 0 && (
                <div className="flex flex-col gap-4">
                  {servers.map((server) => (
                    <Card
                      key={server.name}
                      className="bg-black/40 border-white/20 hover:border-white/40 transition-colors"
                    >
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold text-lg">{server.name}</h3>
                            {server.description && (
                              <p className="text-white/70 text-sm mt-1">{server.description}</p>
                            )}
                            <p className="text-white/50 text-sm mt-2 font-mono break-all">
                              {server.url}
                            </p>
                            <p className="text-white/40 text-xs mt-1">
                              Transport: {server.transport}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => showEditForm(server)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => confirmDeleteServer(server.name)}
                              disabled={loading}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {viewMode !== "list" && (
            <McpServerForm
              initialData={editingServer ?? undefined}
              isEditing={viewMode === "edit"}
              onSubmit={handleSubmit}
              onCancel={showList}
              loading={loading}
            />
          )}
        </div>
      </DialogContent>

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
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
