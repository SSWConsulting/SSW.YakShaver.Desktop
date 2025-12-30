import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../ui/accordion";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { DEFAULT_SERVERS } from "./default-servers";

export type Transport = "streamableHttp" | "stdio" | "inMemory";

type MCPBaseConfig = {
  name: string;
  description?: string;
  transport: Transport;
  builtin?: boolean;
  toolWhitelist?: string[];
};

type MCPHttpServerConfig = MCPBaseConfig & {
  transport: "streamableHttp";
  url: string;
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
};

type MCPStdioServerConfig = MCPBaseConfig & {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: "inherit" | "ignore" | "pipe";
};

type MCPInternalServerConfig = MCPBaseConfig & {
  transport: "inMemory";
  builtin: true;
};

export type MCPServerConfig =
  | MCPHttpServerConfig
  | MCPStdioServerConfig
  | MCPInternalServerConfig;

export const mcpServerSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(
        /^[a-zA-Z0-9_.-]+$/,
        "Only letters, numbers, underscores, hyphens, and dots allowed (no spaces)"
      )
      .refine((val) => !val.includes("__"), {
        message: "Double underscores (__) are not allowed",
      }),
    description: z.string().optional(),
    transport: z.enum(["streamableHttp", "stdio", "inMemory"]),
    url: z.url("Must be a valid URL").optional().or(z.literal("")),
    headers: z.string().optional(),
    version: z.string().optional(),
    timeoutMs: z.number().positive().optional().or(z.literal("")),
    command: z.string().optional(),
    args: z.string().optional(),
    env: z.string().optional(),
    cwd: z.string().optional(),
    stderr: z.enum(["inherit", "ignore", "pipe"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transport === "streamableHttp") {
      if (!data.url || !data.url.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "URL is required for HTTP transports",
        });
      }
    }

    if (data.transport === "stdio") {
      if (!data.command || !data.command.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["command"],
          message: "Command is required for stdio transports",
        });
      }
    }
  });

export type MCPServerFormData = z.infer<typeof mcpServerSchema>;

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
  existingServerNames?: string[];
  isEditing?: boolean;
};

export function McpServerForm({
  form,
  allowedTransports,
  showAdvancedOptions = true,
  advancedOpen,
  onAdvancedOpenChange,
  existingServerNames = [],
  isEditing = false,
}: McpServerFormProps) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const transport = form.watch("transport");
  const transportOptions = (
    allowedTransports?.length ? allowedTransports : undefined
  )
    ? TRANSPORT_OPTIONS.filter((option) =>
        allowedTransports?.includes(option.value)
      )
    : TRANSPORT_OPTIONS;

  const handleCustom = () => {
    setSelectedPreset("Custom");
    form.reset();
  };

  const handleQuickAdd = (server: MCPServerConfig) => {
    setSelectedPreset(server.name);
    form.setValue("name", server.name);
    form.setValue("description", server.description ?? "");
    form.setValue("transport", server.transport);

    if (server.transport === "stdio" && "command" in server) {
      form.setValue("command", server.command);
      form.setValue("args", server.args?.join("\n") ?? "");
      form.setValue(
        "env",
        server.env ? JSON.stringify(server.env, null, 2) : ""
      );
      form.setValue("cwd", server.cwd ?? "");
      form.setValue("stderr", server.stderr ?? "inherit");
    } else if (server.transport === "streamableHttp" && "url" in server) {
      form.setValue("url", server.url);
      form.setValue(
        "headers",
        server.headers ? JSON.stringify(server.headers, null, 2) : ""
      );
      form.setValue("version", server.version ?? "");
      form.setValue("timeoutMs", server.timeoutMs ?? "");
    }
  };

  const presetServers = DEFAULT_SERVERS.filter((server) => {
    const isAllowed =
      !allowedTransports || allowedTransports.includes(server.transport);
    const notExists = !existingServerNames.includes(server.name);
    return isAllowed && notExists;
  });

  const isCustom = selectedPreset === "Custom";
  const disableInput = !isCustom && !isEditing;
  const showForm = isEditing || selectedPreset !== null;

  return (
    <>
      {!isEditing && (
        <div className="flex flex-col gap-2 mb-4">
          <h2 className="text-xl">Select a Server Type</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              className="cursor-pointer"
              type="button"
              variant={isCustom ? "default" : "outline"}
              size="sm"
              onClick={handleCustom}
            >
              Custom
            </Button>
            {presetServers.map((server) => (
              <Button
                key={server.name}
                className="cursor-pointer"
                type="button"
                variant={selectedPreset === server.name ? "default" : "outline"}
                size="sm"
                onClick={() => handleQuickAdd(server)}
              >
                {server.name}
              </Button>
            ))}
          </div>
          {selectedPreset && selectedPreset !== "Custom" && (
            <h4 className="text-sm font-normal leading-5 text-white/[0.56]">
              Presets will auto-fill the form below
            </h4>
          )}
        </div>
      )}

      {showForm && (
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
                  <Input
                    {...field}
                    type="text"
                    disabled={disableInput}
                    placeholder="e.g., GitHub"
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
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    disabled={disableInput}
                    placeholder="e.g., GitHub MCP Server"
                  />
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
                  <Select
                    disabled={disableInput}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
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
                      disabled={disableInput}
                      {...field}
                      type="text"
                      placeholder="e.g., https://api.example.com/mcp/"
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
                    <Input
                      {...field}
                      disabled={disableInput}
                      type="text"
                      placeholder="e.g., npx"
                    />
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
              value={
                advancedOpen === undefined
                  ? undefined
                  : advancedOpen
                  ? "advanced"
                  : ""
              }
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
                                disabled={disableInput}
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
                              <Input
                                {...field}
                                disabled={disableInput}
                                type="text"
                                placeholder="e.g., 1.0.0"
                              />
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
                                disabled={disableInput}
                                value={field.value ?? ""}
                                onChange={(event) =>
                                  field.onChange(
                                    event.target.value
                                      ? Number(event.target.value)
                                      : ""
                                  )
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
                                disabled={disableInput}
                                rows={4}
                                placeholder={`-y\n@modelcontextprotocol/server-filesystem\n.`}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              One flag per line, or provide a JSON array such as
                              ["-y","package"]
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
                              <Textarea
                                {...field}
                                disabled={disableInput}
                                rows={4}
                                placeholder='{"NODE_ENV": "production"}'
                              />
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
                              <Input
                                {...field}
                                disabled={disableInput}
                                type="text"
                                placeholder="Optional working directory"
                              />
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
                              <Select
                                onValueChange={field.onChange}
                                disabled={disableInput}
                                value={field.value ?? "inherit"}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">
                                    inherit (default)
                                  </SelectItem>
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
      )}
    </>
  );
}

type McpServerFormWrapperProps = {
  initialData?: MCPServerConfig;
  isEditing: boolean;
  onSubmit: (data: MCPServerConfig) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
  existingServerNames?: string[];
};

export function McpServerFormWrapper({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  isLoading,
  existingServerNames,
}: McpServerFormWrapperProps) {
  const form = useForm<MCPServerFormData>({
    resolver: zodResolver(mcpServerSchema),
    mode: "onChange",
    defaultValues: {
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      transport: initialData?.transport ?? "streamableHttp",
      url:
        initialData?.transport === "streamableHttp"
          ? initialData?.url ?? ""
          : "",
      headers:
        initialData?.transport === "streamableHttp" && initialData?.headers
          ? JSON.stringify(initialData.headers, null, 2)
          : "",
      version:
        initialData?.transport === "streamableHttp"
          ? initialData?.version ?? ""
          : "",
      timeoutMs:
        initialData?.transport === "streamableHttp" &&
        typeof initialData?.timeoutMs === "number"
          ? initialData.timeoutMs
          : "",
      command:
        initialData?.transport === "stdio" ? initialData?.command ?? "" : "",
      args:
        initialData?.transport === "stdio" && initialData?.args?.length
          ? initialData.args.join("\n")
          : "",
      env:
        initialData?.transport === "stdio" && initialData?.env
          ? JSON.stringify(initialData.env, null, 2)
          : "",
      cwd: initialData?.transport === "stdio" ? initialData?.cwd ?? "" : "",
      stderr:
        initialData?.transport === "stdio"
          ? initialData?.stderr ?? "inherit"
          : "inherit",
    },
  });

  const handleFormSubmit = async (data: MCPServerFormData) => {
    if (data.transport === "streamableHttp") {
      let headers: Record<string, string> | undefined;

      if (data.headers?.trim()) {
        let parsedHeaders: unknown;
        try {
          parsedHeaders = JSON.parse(data.headers);
        } catch {
          form.setError("headers", { message: "Invalid JSON format" });
          return;
        }

        if (
          !parsedHeaders ||
          typeof parsedHeaders !== "object" ||
          Array.isArray(parsedHeaders)
        ) {
          form.setError("headers", {
            message: "Headers must be a JSON object",
          });
          return;
        }

        const headerEntries = Object.entries(parsedHeaders);
        if (!headerEntries.every(([, value]) => typeof value === "string")) {
          form.setError("headers", {
            message: "Header values must be strings",
          });
          return;
        }

        headers = Object.fromEntries(headerEntries) as Record<string, string>;
      }

      const config: MCPServerConfig = {
        name: data.name.trim(),
        transport: "streamableHttp",
        url: data.url?.trim() ?? "",
        description: data.description?.trim() || undefined,
        headers,
        version: data.version?.trim() || undefined,
        timeoutMs:
          typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
      };

      await onSubmit(config);
      return;
    }

    const sanitizeSegment = (value: string): string => {
      let result = value.trim();

      if (result.endsWith(",")) {
        result = result.slice(0, -1).trim();
      }

      if (
        (result.startsWith('"') && result.endsWith('"')) ||
        (result.startsWith("'") && result.endsWith("'"))
      ) {
        result = result.slice(1, -1).trim();
      }

      return result;
    };

    let args: string[] | undefined;
    if (data.args?.trim()) {
      const rawArgs = data.args.trim();
      if (rawArgs.startsWith("[")) {
        try {
          const parsed = JSON.parse(rawArgs);
          if (
            !Array.isArray(parsed) ||
            !parsed.every((value) => typeof value === "string")
          ) {
            form.setError("args", {
              message: "Args JSON must be an array of strings",
            });
            return;
          }
          args = parsed
            .map((segment) => sanitizeSegment(segment))
            .filter((segment) => segment);
        } catch {
          form.setError("args", { message: "Invalid JSON array" });
          return;
        }
      } else {
        args = rawArgs
          .split(/\r?\n/)
          .map((line) => sanitizeSegment(line))
          .filter((line) => line.length > 0);
      }
    }

    let env: Record<string, string> | undefined;
    if (data.env?.trim()) {
      try {
        const parsedEnv = JSON.parse(data.env);
        const entries = Object.entries(parsedEnv);
        if (!entries.every(([, value]) => typeof value === "string")) {
          form.setError("env", {
            message: "Environment values must be strings",
          });
          return;
        }
        env = Object.fromEntries(entries) as Record<string, string>;
      } catch {
        form.setError("env", { message: "Invalid JSON object" });
        return;
      }
    }

    const stderr =
      data.stderr && data.stderr !== "inherit" ? data.stderr : undefined;
    const command = sanitizeSegment(data.command ?? "");

    const config: MCPServerConfig = {
      name: data.name.trim(),
      transport: "stdio",
      command,
      description: data.description?.trim() || undefined,
      args,
      env,
      cwd: data.cwd?.trim() || undefined,
      stderr,
    };

    await onSubmit(config);
  };

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(handleFormSubmit)}
        className="flex flex-col gap-4"
      >
        <h3 className="text-xl font-semibold">
          {isEditing ? "Edit Server" : "Add New Server"}
        </h3>

        <McpServerForm
          form={form}
          existingServerNames={existingServerNames}
          isEditing={isEditing}
        />

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!isLoading && !form.formState.isValid}
          >
            {isLoading ? "Saving..." : "Save Server"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
