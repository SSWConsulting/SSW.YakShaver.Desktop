import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Trash2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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

export interface PromptFormRef {
  isDirty: () => boolean;
}

export const PromptForm = forwardRef<PromptFormRef, PromptFormProps>(
  (
    { defaultValues, onSubmit, onCancel, onDelete, loading, isDefault = false, isNewPrompt = false },
    ref,
  ) => {
    const { copyToClipboard } = useClipboard();
    const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
    const [serversLoaded, setServersLoaded] = useState(false);
    const hasAutoSelectedServers = useRef(false);

    const form = useForm<PromptFormValues>({
      resolver: zodResolver(promptFormSchema),
      defaultValues: defaultValues
        ? { ...defaultValues, selectedMcpServerIds: defaultValues.selectedMcpServerIds ?? [] }
        : { name: "", description: "", content: "", selectedMcpServerIds: [] },
      mode: "onChange",
    });

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
    useEffect(() => {
      if (
        serversLoaded &&
        !isNewPrompt &&
        !hasAutoSelectedServers.current &&
        mcpServers.length > 0
      ) {
        const currentSelection = form.getValues("selectedMcpServerIds");
        if (!currentSelection || currentSelection.length === 0) {
          const allServerIds = mcpServers.map((s) => s.id).filter((id): id is string => !!id);
          form.setValue("selectedMcpServerIds", allServerIds, { shouldDirty: false });
        }
        hasAutoSelectedServers.current = true;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serversLoaded, isNewPrompt, mcpServers]);

    // Expose form state to parent via ref
    // Use empty dependency array to keep ref stable - access form.formState.isDirty directly
    useImperativeHandle(
      ref,
      () => ({
        isDirty: () => form.formState.isDirty,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const handleSubmit = async (andActivate: boolean) => {
      const isValid = await form.trigger();
      if (!isValid) return;

      const data = form.getValues();

      // Validate that at least one non-built-in MCP server is selected (if any are available)
      const availableNonBuiltinServers = mcpServers.filter((server) => !server.builtin);
      if (availableNonBuiltinServers.length > 0) {
        const selectedNonBuiltinServers = availableNonBuiltinServers.filter((server) =>
          data.selectedMcpServerIds?.includes(server.id!),
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
              render={({ field }) => (
                <FormItem className="shrink-0">
                  <FormLabel>MCP Servers *</FormLabel>
                  <FormDescription>
                    Select which MCP servers will receive this prompt's output
                  </FormDescription>
                  <div className="flex flex-col gap-2 mt-2 p-3 rounded-md border border-white/20 bg-black/20">
                    {mcpServers
                      .filter((server): server is MCPServerConfig & { id: string } => !!server.id)
                      .map((server) => (
                        <div
                          key={server.id}
                          className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 rounded"
                          onClick={() => {
                            const currentValue = field.value || [];
                            const isCurrentlyChecked = currentValue.includes(server.id);
                            const newValue = isCurrentlyChecked
                              ? currentValue.filter((id) => id !== server.id)
                              : [...currentValue, server.id];
                            field.onChange(newValue);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const currentValue = field.value || [];
                              const isCurrentlyChecked = currentValue.includes(server.id);
                              const newValue = isCurrentlyChecked
                                ? currentValue.filter((id) => id !== server.id)
                                : [...currentValue, server.id];
                              field.onChange(newValue);
                            }
                          }}
                          role="checkbox"
                          aria-checked={field.value?.includes(server.id) ?? false}
                          tabIndex={0}
                        >
                          <Checkbox
                            checked={field.value?.includes(server.id) ?? false}
                            onCheckedChange={(checked) => {
                              if (checked === "indeterminate") return;
                              const currentValue = field.value || [];
                              const newValue = checked
                                ? [...currentValue, server.id]
                                : currentValue.filter((id) => id !== server.id);
                              field.onChange(newValue);
                            }}
                          />
                          <span className="text-sm">
                            {server.name}
                            {server.builtin && (
                              <span className="ml-2 text-xs text-white/50">(Built-in)</span>
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
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
  },
);

PromptForm.displayName = "PromptForm";
