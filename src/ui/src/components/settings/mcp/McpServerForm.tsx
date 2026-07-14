import { zodResolver } from "@hookform/resolvers/zod";
import type { MCPServerConfig, Transport } from "@shared/types/mcp";
import { type FormEvent, useMemo, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../ui/accordion";
import { Button } from "../../ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Form as FormProvider,
} from "../../ui/form";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { McpServerImportPreview } from "./McpServerImportPreview";
import {
  formatMcpServerFormDraftJson,
  formatMcpServerJson,
  formDataToMcpServerConfig,
  type MCPServerFormData,
  mcpServerConfigToFormData,
  mcpServerSchema,
  parseMcpServersJson,
} from "./mcp-server-config";

export type { MCPServerConfig, Transport };
export { type MCPServerFormData, mcpServerSchema } from "./mcp-server-config";

const TRANSPORT_OPTIONS: Array<{ value: Transport; label: string }> = [
  { value: "streamableHttp", label: "HTTP (streamableHttp)" },
  { value: "stdio", label: "STDIO (local process)" },
];

type McpServerFormProps = {
  form: UseFormReturn<MCPServerFormData>;
  allowedTransports?: Transport[];
  showAdvancedOptions?: boolean;
  advancedOpen?: boolean;
  onAdvancedOpenChange?: (isOpen: boolean) => void;
};

export function McpServerForm({
  form,
  allowedTransports,
  showAdvancedOptions = true,
  advancedOpen,
  onAdvancedOpenChange,
}: McpServerFormProps) {
  const transport = form.watch("transport");
  const transportOptions = allowedTransports?.length
    ? TRANSPORT_OPTIONS.filter((option) => allowedTransports?.includes(option.value))
    : TRANSPORT_OPTIONS;

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Name <span className="text-red-400">*</span>
            </FormLabel>
            <FormControl>
              <Input {...field} type="text" placeholder="e.g., GitHub" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Input {...field} type="text" placeholder="e.g., GitHub MCP Server" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="transport"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Transport <span className="text-red-400">*</span>
            </FormLabel>
            <FormControl>
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Transport" />
                </SelectTrigger>
                <SelectContent>
                  {transportOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {transport === "streamableHttp" && (
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                URL <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  placeholder="e.g., https://api.githubcopilot.com/mcp/"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {transport === "stdio" && (
        <FormField
          control={form.control}
          name="command"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Command <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input {...field} type="text" placeholder="e.g., npx" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {showAdvancedOptions && (
        <Accordion
          type="single"
          collapsible
          value={advancedOpen === undefined ? undefined : advancedOpen ? "advanced" : ""}
          onValueChange={(value) => {
            onAdvancedOpenChange?.(value === "advanced");
          }}
        >
          <AccordionItem value="advanced">
            <AccordionTrigger className="text-base font-medium text-white/90">
              Advanced Options
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4 pt-4">
              {transport === "streamableHttp" && (
                <>
                  <FormField
                    control={form.control}
                    name="headers"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Headers</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder='{"Authorization": "Bearer YOUR_TOKEN"}'
                            rows={4}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          JSON format, e.g., Authorization headers
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="version"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Version</FormLabel>
                        <FormControl>
                          <Input {...field} type="text" placeholder="e.g., 1.0.0" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="timeoutMs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timeout (ms)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            onChange={(event) =>
                              field.onChange(event.target.value ? Number(event.target.value) : "")
                            }
                            type="number"
                            placeholder="60000"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {transport === "stdio" && (
                <>
                  <FormField
                    control={form.control}
                    name="args"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Arguments</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={4}
                            placeholder={`-y\n@modelcontextprotocol/server-filesystem\n.`}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          One flag per line, or provide a JSON array such as ["-y","package"]
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="env"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Environment Variables</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={4} placeholder='{"NODE_ENV": "production"}' />
                        </FormControl>
                        <FormDescription className="text-xs">
                          JSON object mapping variable name to value
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cwd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Working Directory</FormLabel>
                        <FormControl>
                          <Input {...field} type="text" placeholder="Optional working directory" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stderr"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>stderr Handling</FormLabel>
                        <FormControl>
                          <Select onValueChange={field.onChange} value={field.value ?? "inherit"}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inherit">inherit (default)</SelectItem>
                              <SelectItem value="ignore">ignore</SelectItem>
                              <SelectItem value="pipe">pipe</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </>
  );
}

type McpServerFormWrapperProps = {
  initialData?: MCPServerConfig;
  isEditing: boolean;
  onSubmit: (data: MCPServerConfig) => Promise<void>;
  onSubmitMany?: (data: MCPServerConfig[]) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  hideDeleteServerButton?: boolean;
  isLoading: boolean;
  existingServerNames?: string[];
};

export function McpServerFormWrapper({
  initialData,
  isEditing,
  onSubmit,
  onSubmitMany,
  onCancel,
  onDelete,
  hideDeleteServerButton,
  isLoading,
}: McpServerFormWrapperProps) {
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState(() =>
    initialData
      ? formatMcpServerJson(initialData)
      : JSON.stringify(
          {
            name: "",
            description: "",
            transport: "streamableHttp",
            url: "",
          },
          null,
          2,
        ),
  );
  const form = useForm<MCPServerFormData>({
    resolver: zodResolver(mcpServerSchema),
    mode: "onChange",
    defaultValues: mcpServerConfigToFormData(initialData),
  });
  const parsedJson = useMemo(() => parseMcpServersJson(jsonText), [jsonText]);

  const handleFormSubmit = async (data: MCPServerFormData) => {
    const result = formDataToMcpServerConfig(data, initialData?.id);
    if (!result.success) {
      if (result.field) {
        form.setError(result.field, { message: result.message });
      }
      return;
    }

    await onSubmit(result.config);
  };

  const handleModeChange = (nextMode: "form" | "json") => {
    if (nextMode === mode) {
      return;
    }

    if (nextMode === "json") {
      setJsonText(formatMcpServerFormDraftJson(form.getValues()));
      setJsonError(null);
      setMode("json");
      return;
    }

    if (parsedJson.success && parsedJson.configs.length === 1) {
      form.reset(mcpServerConfigToFormData(parsedJson.configs[0]));
    }

    setJsonError(null);
    setMode("form");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (mode === "form") {
      await form.handleSubmit(handleFormSubmit)(event);
      return;
    }

    event.preventDefault();
    if (!parsedJson.success) {
      setJsonError(parsedJson.message);
      return;
    }

    setJsonError(null);
    if (parsedJson.configs.length === 1) {
      await onSubmit({ ...parsedJson.configs[0], id: initialData?.id ?? "" });
      return;
    }
    if (!onSubmitMany) {
      setJsonError("Multiple MCP servers can only be imported from the Add Server form");
      return;
    }
    await onSubmitMany(parsedJson.configs);
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
        <h3 className="text-xl font-semibold">{isEditing ? "Edit Server" : "Add New Server"}</h3>

        {!isEditing && (
          <fieldset className="flex w-fit rounded-md border border-border p-1">
            <legend className="sr-only">Server configuration mode</legend>
            <Button
              type="button"
              size="sm"
              variant={mode === "form" ? "secondary" : "ghost"}
              aria-pressed={mode === "form"}
              onClick={() => handleModeChange("form")}
            >
              Form
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "json" ? "secondary" : "ghost"}
              aria-pressed={mode === "json"}
              onClick={() => handleModeChange("json")}
            >
              JSON
            </Button>
          </fieldset>
        )}

        {mode === "form" ? (
          <McpServerForm form={form} />
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="mcp-server-json" className="text-sm font-medium">
                MCP server JSON
              </label>
              <Textarea
                id="mcp-server-json"
                value={jsonText}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  setJsonError(null);
                }}
                className="mt-2 min-h-64 font-mono text-sm"
                aria-invalid={jsonError !== null}
                aria-describedby="mcp-server-json-help mcp-server-json-error"
                spellCheck={false}
              />
              <p id="mcp-server-json-help" className="mt-1 text-xs text-muted-foreground">
                Use a flat server object with name, transport, and either url or command.
              </p>
              {jsonError && (
                <p
                  id="mcp-server-json-error"
                  className="mt-1 text-sm text-destructive"
                  role="alert"
                >
                  {jsonError}
                </p>
              )}
            </div>

            {parsedJson.success && <McpServerImportPreview configs={parsedJson.configs} />}
          </div>
        )}

        <div className="flex w-full items-center">
          {onDelete && !hideDeleteServerButton && (
            <div className="flex flex-1 justify-start">
              <Button variant="destructiveOutline" onClick={onDelete}>
                Delete Server
              </Button>
            </div>
          )}
          <div className="flex grow gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="cursor-pointer"
              disabled={isLoading || (mode === "form" && !form.formState.isValid)}
            >
              Save Server
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
