import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../../services/ipc-client";
import { formatIpcErrorMessage, formatToolName } from "../../../utils";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { ScrollArea } from "../../ui/scroll-area";
import type { MCPServerConfig } from "./McpServerForm";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // On close, clear transient state so a re-open never shows a stale
    // tool list or error (e.g. after reauthorizing from the card) (#982).
    if (!server) {
      setError(null);
      setTools([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    setTools([]);
    setSelected(new Set(server.toolWhitelist ?? []));
    // Guard against a late response landing after the dialog closed or the user
    // switched servers — otherwise a stale request overwrites the current tools
    // or error (#982).
    let cancelled = false;
    ipcClient.mcp
      .listServerTools(server.id ?? server.name)
      .then((list) => {
        if (cancelled) return;
        const valid = list.filter((t) => t && typeof t.name === "string");
        const sorted = [...valid].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        setTools(sorted);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(`Failed to load tools: ${formatIpcErrorMessage(e)}`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
    if (!server || !server.id) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated: MCPServerConfig = {
        ...server,
        toolWhitelist: Array.from(selected),
      };
      await ipcClient.mcp.updateServerAsync(server.id, updated);
      toast.success(`Whitelist updated for '${server.name}'`);
      onSaved();
    } catch (e) {
      setError(`Failed to save whitelist: ${formatIpcErrorMessage(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [server, selected, onSaved]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>MCP Tools</DialogTitle>
          <DialogDescription>
            Add or remove tool from whitelist for server '{server?.name}'.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-2">
          <div className="flex flex-col gap-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading tools…</p>}
            {!isLoading && tools.length === 0 && !error && (
              <p className="text-sm text-muted-foreground">No tools available.</p>
            )}
            {!isLoading && tools.length > 0 && (
              <div className="flex flex-col gap-2">
                {tools.map((tool) => {
                  const checkboxId = `whitelist-${tool.name}`;
                  return (
                    // min-h-11 gives the row a 44px-tall click target (WCAG 2.5.5).
                    // items-start top-aligns the checkbox against multi-line
                    // descriptions; the label is self-stretch + flex flex-col
                    // justify-center so it fills the full row height via htmlFor —
                    // so even a description-less (single-line) row exposes the whole
                    // 44px row as the hit area, matching the other call sites.
                    <div key={tool.name} className="flex items-start gap-3 min-h-11 py-1">
                      <Checkbox
                        id={checkboxId}
                        className="mt-1"
                        checked={selected.has(tool.name)}
                        onCheckedChange={() => toggleTool(tool.name)}
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex-1 self-stretch flex flex-col justify-center cursor-pointer select-none"
                      >
                        <p className="text-sm">{formatToolName(tool.name)}</p>
                        {tool.description && (
                          <p className="text-xs text-muted-foreground">{tool.description}</p>
                        )}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
        {error && (
          // Persistent inline error (not a fleeting toast), styled like SettingsWarningBanner (#982).
          <div
            role="alert"
            className="flex flex-col gap-1.5 rounded-md border border-ssw-red/40 bg-ssw-red/10 px-4 py-3"
          >
            {/* Header row: icon + "No tools available." reads as the error's title. */}
            <div className="flex items-center gap-2 text-sm font-semibold text-ssw-red">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>No tools available</span>
            </div>
            {/* Detail: kept verbatim, in a softer light tone + smaller size so the
                long transport message stays legible against the dark tinted bg (#982). */}
            <p className="pl-6 text-xs leading-relaxed text-foreground/80 wrap-break-word whitespace-normal">
              {error}
            </p>
          </div>
        )}
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
