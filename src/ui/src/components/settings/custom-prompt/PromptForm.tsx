import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, ChevronRight, Copy, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useClipboard } from "../../../hooks/useClipboard";
import { ipcClient } from "../../../services/ipc-client";
import { Button } from "../../ui/button";
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
import { Textarea } from "../../ui/textarea";
import type { MCPServerConfig } from "../mcp/McpServerForm";
import { type PromptFormValues, promptFormSchema } from "./schema";

interface PromptFormProps {
  defaultValues?: PromptFormValues;
  onSubmit: (data: PromptFormValues, andActivate: boolean) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  loading: boolean;
  isDefault?: boolean;
  isNewPrompt?: boolean;
}

interface InternalPromptFormProps extends PromptFormProps {
  onDirtyChange?: (isDirty: boolean) => void;
}

export function PromptForm({
  defaultValues,
  onSubmit,
  onCancel,
  onDelete,
  loading,
  isDefault = false,
  isNewPrompt = false,
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

  // Auto-select all servers for existing prompts without selectedMcpServerIds
  // This runs once after servers are loaded
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally omitting form methods to prevent re-runs
  useEffect(() => {
    if (serversLoaded && !isNewPrompt && !hasAutoSelectedServers.current && mcpServers.length > 0) {
      const currentSelection = form.getValues("selectedMcpServerIds");
      if (!currentSelection || currentSelection.length === 0) {
        const allServerIds = mcpServers.map((s) => s.id).filter((id): id is string => !!id);
        form.setValue("selectedMcpServerIds", allServerIds, { shouldDirty: false });
      }
      hasAutoSelectedServers.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serversLoaded, isNewPrompt, mcpServers]);

  const handleSubmit = async (andActivate: boolean) => {
    const isValid = await form.trigger();
    if (!isValid) return;

    const data = form.getValues();

    // Validate that at least one non-built-in MCP server is selected (if any are available)
    const availableNonBuiltinServers = mcpServers.filter((server) => !server.builtin);
    if (availableNonBuiltinServers.length > 0) {
      const selectedNonBuiltinServers = availableNonBuiltinServers.filter(
        (server) => server.id && data.selectedMcpServerIds?.includes(server.id),
      );
      if (selectedNonBuiltinServers.length === 0) {
        form.setError("selectedMcpServerIds", {
          type: "manual",
          message: "At least one non-built-in MCP server must be selected",
        });
        return;
      }
    }

    await onSubmit(data, andActivate);
  };

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4 h-full max-w-full">
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
                  disabled={isDefault}
                />
              </FormControl>
              {isDefault ? (
                <FormDescription>Default prompt name cannot be changed</FormDescription>
              ) : (
                <FormMessage />
              )}
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
                  disabled={isDefault}
                />
              </FormControl>
              <FormDescription>
                {isDefault
                  ? "Default prompt description cannot be changed"
                  : "This will be shown in the prompt card for quick reference"}
              </FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="flex flex-col flex-1 min-h-0 overflow-hidden shrink-0 max-w-full">
              <div className="flex items-center justify-between">
                <FormLabel className="text-white/90 text-sm">Prompt Instructions</FormLabel>
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
              <FormControl>
                <Textarea
                  {...field}
                  placeholder="Enter your custom instructions here..."
                  disabled={isDefault}
                  className="resize-none flex-1 max-h-50 overflow-y-auto font-mono text-sm bg-black/40 border-white/20 max-w-full wrap-break-word break-normal whitespace-pre-wrap overflow-x-hidden [word-break:break-word]"
                />
              </FormControl>
              <FormDescription>
                {isDefault
                  ? "Default prompt instructions cannot be changed"
                  : "These instructions will be appended to the task execution system prompt"}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {serversLoaded && mcpServers.length > 0 && (
          <FormField
            control={form.control}
            name="selectedMcpServerIds"
            render={({ field }) => {
              const serversWithIds = mcpServers.filter(
                (server): server is MCPServerConfig & { id: string } => !!server.id,
              );
              const totalPages = Math.ceil(serversWithIds.length / SERVERS_PER_PAGE);
              const paginatedServers = serversWithIds.slice(
                serverPage * SERVERS_PER_PAGE,
                (serverPage + 1) * SERVERS_PER_PAGE,
              );
              const selectedNames = serversWithIds
                .filter((s) => field.value?.includes(s.id))
                .map((s) => s.name);

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

                  {/* Note: Using styled divs instead of Radix UI Checkbox here because
                        Radix Checkbox causes React Error #185 (infinite loop) when used
                        inside FormField + map + conditional rendering. The issue is related
                        to Radix's internal ref management conflicting with this render pattern.
                        Multiple workarounds were attempted (memoization, removing handlers,
                        pointer-events-none) but none resolved the issue. */}
                  <div className="flex flex-col gap-2 mt-2 p-3 rounded-md border border-white/20 bg-black/20">
                    {paginatedServers.map((server) => {
                      const isChecked = field.value?.includes(server.id) ?? false;
                      const handleToggle = () => {
                        const newValue = isChecked
                          ? (field.value || []).filter((id) => id !== server.id)
                          : [...(field.value || []), server.id];
                        field.onChange(newValue);
                      };
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: Using div instead of input because Radix Checkbox causes React Error #185
                        <div
                          key={server.id}
                          className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 rounded"
                          onClick={handleToggle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleToggle();
                            }
                          }}
                          role="checkbox"
                          aria-checked={isChecked}
                          tabIndex={0}
                        >
                          <div
                            className={`h-4 w-4 shrink-0 rounded-sm border transition-colors ${
                              isChecked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-primary/50"
                            }`}
                          >
                            {isChecked && <Check className="h-4 w-4 p-0.5" />}
                          </div>
                          <span className="text-sm">
                            {server.name}
                            {server.builtin && (
                              <span className="ml-2 text-xs text-white/50">(Built-in)</span>
                            )}
                          </span>
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
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}

        {serversLoaded && mcpServers.length === 0 && (
          <div className="text-sm text-yellow-500/80 p-3 rounded-md border border-yellow-500/30 bg-yellow-500/10">
            No MCP servers configured. Please add MCP servers in the MCP settings tab.
          </div>
        )}

        <div className="flex justify-between gap-2 shrink-0">
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
              onClick={() => handleSubmit(false)}
              disabled={loading || !form.formState.isValid}
              size="sm"
              className="cursor-pointer"
            >
              {loading ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={loading || !form.formState.isValid}
              size="sm"
              className="cursor-pointer"
            >
              {loading ? "Saving..." : "Save & Use"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
