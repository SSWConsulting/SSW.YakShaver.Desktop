import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { MCPServerConfig } from "./McpServerForm";
import { ipcClient } from "../../../services/ipc-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Checkbox } from "../../ui/checkbox";
import { ScrollArea } from "../../ui/scroll-area";
import { Button } from "../../ui/button";

type ToolSummary = { name: string; description?: string };

type McpWhitelistDialogProps = {
  server: MCPServerConfig | null;
  onClose: () => void;
  onSaved: () => void;
};

export function McpWhitelistDialog({ server, onClose, onSaved }: McpWhitelistDialogProps) {
  const open = !!server;
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!server) return;
    setIsLoading(true);
    setTools([]);
    setSelected(new Set(server.toolWhitelist ?? []));
    ipcClient.mcp
      .listServerTools(server.name)
      .then((list) => {
        const valid = list.filter((t) => t && typeof t.name === "string");
        const sorted = [...valid].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        setTools(sorted);
      })
      .catch((e) => {
        toast.error(`Failed to load tools: ${String(e)}`);
      })
      .finally(() => setIsLoading(false));
  }, [server]);

  const toggleTool = useCallback((toolName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  }, []);

  const disabled = useMemo(() => isLoading || isSaving, [isLoading, isSaving]);

  const handleSave = useCallback(async () => {
    if (!server) return;
    setIsSaving(true);
    try {
      const updated: MCPServerConfig = {
        ...server,
        toolWhitelist: Array.from(selected),
      } as MCPServerConfig;
      await ipcClient.mcp.updateServerAsync(server.name, updated);
      toast.success(`Whitelist updated for '${server.name}'`);
      onSaved();
    } catch (e) {
      toast.error(`Failed to save whitelist: ${String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [server, selected, onSaved]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Tool Whitelist</DialogTitle>
          <DialogDescription>
            Add or remove tool from whitelist for server '{server?.name}'.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-2">
          <div className="flex flex-col gap-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading tools…</p>}
            {!isLoading && tools.length === 0 && (
              <p className="text-sm text-muted-foreground">No tools available.</p>
            )}
            {!isLoading && tools.length > 0 && (
              <div className="flex flex-col gap-2">
              {tools.map((tool) => (
                <div key={tool.name} className="flex items-start gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(tool.name)}
                    onCheckedChange={() => toggleTool(tool.name)}
                  />
                  <div className="flex-1">
                    <p className="text-sm">{tool.name}</p>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    )}
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={disabled}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={disabled}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
