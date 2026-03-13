import { zodResolver } from "@hookform/resolvers/zod";
import { ensureBuiltinServerIds, getBuiltinServerIds } from "@shared/utils/mcp-utils";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, FilePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useClipboard } from "../../../hooks/useClipboard";
import { ipcClient } from "../../../services/ipc-client";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../ui/form";
import { Input } from "../../ui/input";
import type { MCPServerConfig } from "../mcp/McpServerForm";
import { HighlightedTextarea } from "./HighlightedTextarea";
import { type PromptFormValues, promptFormSchema } from "./schema";

interface PromptFormProps {
  defaultValues?: PromptFormValues;
  onSubmit?: (data: PromptFormValues) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  onUseTemplate?: () => void;
  loading: boolean;
  isDefault?: boolean;
  isTemplate?: boolean;
  templateContent?: string;
  isNewPrompt?: boolean;
  selectAllServersForNewPrompt?: boolean;
}

interface InternalPromptFormProps extends PromptFormProps {
  selectAllServersForNewPrompt?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function PromptForm({
  defaultValues,
  onSubmit,
  onCancel,
  onDelete,
  onUseTemplate,
  loading,
  isDefault = false,
  isTemplate = false,
  templateContent,
  isNewPrompt = false,
  selectAllServersForNewPrompt = false,
  onDirtyChange,
}: InternalPromptFormProps) {
  const { copyToClipboard } = useClipboard();
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const hasAutoSelectedServers = useRef(false);
  const [serverPage, setServerPage] = useState(0);
  const SERVERS_PER_PAGE = 10;

  const form = useForm<PromptFormValues>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: defaultValues
      ? { ...defaultValues, selectedMcpServerIds: defaultValues.selectedMcpServerIds ?? [] }
      : { name: "", description: "", content: "", selectedMcpServerIds: [] },
    mode: "onChange",
  });

  // Notify parent of dirty state changes
  const { isDirty } = form.formState;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const serversWithIds = useMemo(
    () => mcpServers.filter((server): server is MCPServerConfig & { id: string } => !!server.id),
    [mcpServers],
  );
  const totalPages = Math.ceil(serversWithIds.length / SERVERS_PER_PAGE);
  const paginatedServers = useMemo(
    () => serversWithIds.slice(serverPage * SERVERS_PER_PAGE, (serverPage + 1) * SERVERS_PER_PAGE),
    [serversWithIds, serverPage],
  );

  // Load MCP servers on mount
  useEffect(() => {
    let cancelled = false;
    const loadServers = async () => {
      try {
        const servers = await ipcClient.mcp.listServers();
        if (cancelled) return;
        setMcpServers(servers);
        setServersLoaded(true);
      } catch (error) {
        console.error("Failed to load MCP servers:", error);
        if (!cancelled) setServersLoaded(true);
      }
    };
    void loadServers();
    return () => {
      cancelled = true;
    };
  }, []);

  // Adjust page when server list length changes to avoid showing an empty page
  useEffect(() => {
    setServerPage((prevPage) => {
      if (mcpServers.length === 0) return 0;
      const maxPage = Math.max(0, Math.ceil(mcpServers.length / SERVERS_PER_PAGE) - 1);
      return Math.min(prevPage, maxPage);
    });
  }, [mcpServers.length]);

  // Initialise MCP server selection once after servers are loaded. Three cases:
  //   default prompt  → select all servers (locked, not editable)
  //   new prompt      → pre-select built-in server IDs only
  //   existing prompt → keep saved selection and ensure built-ins are always included;
  //                     if no prior selection exists, default to all non-builtin servers
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally omitting form methods to prevent re-runs
  useEffect(() => {
    if (serversLoaded && !hasAutoSelectedServers.current && mcpServers.length > 0) {
      if (isDefault || isTemplate) {
        const allServerIds = mcpServers.map((s) => s.id).filter((id): id is string => !!id);
        form.setValue("selectedMcpServerIds", allServerIds, { shouldDirty: false });
      } else if (isNewPrompt) {
        const ids = selectAllServersForNewPrompt
          ? mcpServers.map((s) => s.id).filter((id): id is string => !!id)
          : getBuiltinServerIds(mcpServers);
        form.setValue("selectedMcpServerIds", ids, { shouldDirty: false });
      } else {
        const currentSelection = form.getValues("selectedMcpServerIds");
        if (!currentSelection || currentSelection.length === 0) {
          // No prior selection: default to all non-builtin servers (regardless of connection status)
          const allNonBuiltinIds = mcpServers
            .filter((s) => !s.builtin)
            .map((s) => s.id)
            .filter((id): id is string => !!id);
          form.setValue(
            "selectedMcpServerIds",
            ensureBuiltinServerIds(allNonBuiltinIds, mcpServers),
            { shouldDirty: false },
          );
        } else {
          // Existing selection: preserve it and silently add any missing built-ins
          form.setValue(
            "selectedMcpServerIds",
            ensureBuiltinServerIds(currentSelection, mcpServers),
            { shouldDirty: false },
          );
        }
      }
      hasAutoSelectedServers.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversLoaded, isDefault, isTemplate, isNewPrompt, selectAllServersForNewPrompt, mcpServers]);

  const handleSubmit = async () => {
    const isValid = await form.trigger();
    if (!isValid) return;

    const data = form.getValues();

    if (!isDefault && !isTemplate) {
      const nonBuiltinServers = mcpServers.filter((s) => !s.builtin);

      // Case 1: no non-builtin servers exist at all → hard block
      if (nonBuiltinServers.length === 0) {
        form.setError("selectedMcpServerIds", {
          type: "manual",
          message: "No MCP servers configured. Please add a server in the MCP settings tab.",
        });
        return;
      }

      // Case 2: non-builtin servers exist but none are selected → hard block
      const selectedNonBuiltinIds = (data.selectedMcpServerIds ?? []).filter((id) =>
        nonBuiltinServers.some((s) => s.id === id),
      );
      if (selectedNonBuiltinIds.length === 0) {
        form.setError("selectedMcpServerIds", {
          type: "manual",
          message: "Please select at least one MCP server (excluding built-in servers).",
        });
        return;
      }

      // Case 3: all selected non-builtins are disconnected → soft warning, allow save (handled in UI)
    }

    await onSubmit?.(data);
  };

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4 max-w-full">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="shrink-0">
              <FormLabel>Prompt Name *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="e.g., Documentation Writer, Code Reviewer"
                  disabled={isDefault || isTemplate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="shrink-0">
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Brief description of what this prompt does"
                  disabled={isDefault || isTemplate}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => {
            const hasPlaceholders = /<REPLACE[A-Z0-9_ ]+>/.test(field.value ?? "");
            return (
              <FormItem className="flex flex-col shrink-0 max-w-full">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <FormLabel className="text-white/90 text-sm">Prompt Instructions *</FormLabel>
                  <div className="flex items-center gap-1">
                    {!isTemplate && templateContent && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          form.setValue("content", templateContent, { shouldDirty: true })
                        }
                        className="cursor-pointer text-xs h-7 px-2"
                      >
                        <FilePlus className="w-3 h-3 mr-1" />
                        Insert template
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(field.value)}
                      className="cursor-pointer"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </Button>
                  </div>
                </div>
                <FormControl>
                  <HighlightedTextarea
                    {...field}
                    placeholder="Enter your custom instructions here..."
                    disabled={isDefault || isTemplate}
                    containerClassName="h-64"
                  />
                </FormControl>
                {hasPlaceholders && !isTemplate && (
                  <p className="text-xs text-amber-500/80 flex items-center gap-1 mt-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Replace all placeholders before saving
                  </p>
                )}
                <FormMessage />
              </FormItem>
            );
          }}
        />

        {serversLoaded && mcpServers.length > 0 && (
          <FormField
            control={form.control}
            name="selectedMcpServerIds"
            render={({ field }) => {
              const selectedNames = serversWithIds
                .filter((s) => field.value?.includes(s.id))
                .map((s) => s.name);

              const hasDisconnectedSelection =
                !isDefault &&
                !isTemplate &&
                serversWithIds.some(
                  (s) => !s.builtin && s.enabled === false && field.value?.includes(s.id),
                );

              return (
                <FormItem className="shrink-0">
                  <FormLabel>MCP Servers *</FormLabel>
                  <FormDescription>
                    Select which MCP servers' tools can be used during this prompt's execution
                  </FormDescription>

                  {/* Summary of selected servers */}
                  <div className="text-xs text-white/70 mt-1">
                    <span className="font-medium">Selected: </span>
                    {selectedNames.length > 0 ? (
                      <span>{selectedNames.join(", ")}</span>
                    ) : (
                      <span className="text-white/40 italic">None</span>
                    )}
                  </div>

                  <div
                    className="flex flex-col gap-2 mt-2 p-3 rounded-md border border-white/20 bg-black/20"
                    aria-live="polite"
                  >
                    {paginatedServers.map((server) => {
                      const isBuiltin = server.builtin ?? false;
                      const isServerDisabled = server.enabled === false;
                      const isChecked =
                        isDefault ||
                        isTemplate ||
                        isBuiltin ||
                        (field.value?.includes(server.id) ?? false);
                      // Lock checkboxes for template/default prompts and built-ins
                      const isCheckboxDisabled = isDefault || isTemplate || isBuiltin;
                      const handleToggle = () => {
                        const newValue = isChecked
                          ? (field.value || []).filter((id) => id !== server.id)
                          : [...(field.value || []), server.id];
                        field.onChange(newValue);
                      };
                      return (
                        <div key={server.id} className="flex items-center gap-3 p-1 rounded">
                          <Checkbox
                            id={`server-${server.id}`}
                            checked={isChecked}
                            onCheckedChange={handleToggle}
                            disabled={isCheckboxDisabled}
                          />
                          <label
                            htmlFor={`server-${server.id}`}
                            className={`text-sm flex-1 select-none ${
                              isCheckboxDisabled ? "cursor-not-allowed" : "cursor-pointer"
                            }`}
                          >
                            {server.name}
                            {isBuiltin && (
                              <span className="ml-2 text-xs text-white/50">(Built-in)</span>
                            )}
                            {isServerDisabled && (
                              <span className="ml-2 text-xs text-yellow-500/70">
                                (Not connected)
                              </span>
                            )}
                          </label>
                        </div>
                      );
                    })}

                    {/* Pagination controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-white/10">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setServerPage((p) => Math.max(0, p - 1))}
                          disabled={serverPage === 0}
                          className="h-7 px-2 cursor-pointer"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Prev
                        </Button>
                        <span className="text-xs text-white/50">
                          Page {serverPage + 1} of {totalPages}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setServerPage((p) => Math.min(totalPages - 1, p + 1))}
                          disabled={serverPage >= totalPages - 1}
                          className="h-7 px-2 cursor-pointer"
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {hasDisconnectedSelection && (
                    <p className="text-xs text-yellow-500/80 mt-1">
                      Some selected servers are disconnected. Connect them in MCP settings tab to
                      make their tools available.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}

        {serversLoaded && mcpServers.every((s) => s.builtin) && (
          <div className="text-sm text-yellow-500/80 p-3 rounded-md border border-yellow-500/30 bg-yellow-500/10">
            No external MCP servers configured. You can add additional MCP servers in the MCP
            settings tab.
          </div>
        )}

        <div className="flex justify-between gap-2 shrink-0">
          {isTemplate ? (
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="cursor-pointer"
              >
                Close
              </Button>
              {onUseTemplate && (
                <Button type="button" size="sm" onClick={onUseTemplate} className="cursor-pointer">
                  Use Template
                </Button>
              )}
            </div>
          ) : (
            <>
              {onDelete && (
                <Button
                  type="button"
                  onClick={onDelete}
                  variant="destructive"
                  size="sm"
                  disabled={loading}
                  className="cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSubmit()}
                  disabled={loading || !form.formState.isValid}
                  size="sm"
                  className="cursor-pointer"
                >
                  {loading ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </form>
    </Form>
  );
}
