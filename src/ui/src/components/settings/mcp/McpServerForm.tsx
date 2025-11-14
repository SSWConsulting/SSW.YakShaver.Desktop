import { zodResolver } from "@hookform/resolvers/zod";
import { type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
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
import { Switch } from "../../ui/switch";
import { Textarea } from "../../ui/textarea";

export type Transport = "streamableHttp" | "stdio";

export type MCPServerConfig = {
  name: string;
  description?: string;
  transport: Transport;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
  enabled?: boolean;
};

const mcpServerSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(
        /^[a-zA-Z0-9 _-]+$/,
        "Only letters, numbers, spaces, underscores, and hyphens allowed",
      ),
    description: z.string().optional(),
    transport: z.enum(["streamableHttp", "stdio"]),
    url: z.string().optional(),
    headers: z.string().optional(),
    command: z.string().optional(),
    // Note: The 'args' field is a string in the form data (newline-separated arguments).
    // It is converted to a string[] on submission to match MCPServerConfig.
    args: z.string().optional(),
    env: z.string().optional(),
    version: z.string().optional(),
    timeoutMs: z.number().positive().optional().or(z.literal("")),
    enabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transport === "streamableHttp") {
      if (!data.url?.trim()) {
        ctx.addIssue({
          path: ["url"],
          code: z.ZodIssueCode.custom,
          message: "URL is required for HTTP transports",
        });
      } else {
        try {
          new URL(data.url);
        } catch {
          ctx.addIssue({
            path: ["url"],
            code: z.ZodIssueCode.custom,
            message: "Must be a valid URL",
          });
        }
      }
    } else if (data.transport === "stdio") {
      if (!data.command?.trim()) {
        ctx.addIssue({
          path: ["command"],
          code: z.ZodIssueCode.custom,
          message: "Command is required for stdio transports",
        });
      }
    }
  });

type MCPServerFormData = z.infer<typeof mcpServerSchema>;

type McpServerFormProps = {
  form: UseFormReturn<MCPServerFormData>;
};

export function McpServerForm({ form }: McpServerFormProps) {
  const transport = form.watch("transport");

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-white/90">
              Name <span className="text-red-400">*</span>
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                type="text"
                placeholder="e.g., GitHub"
                className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
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
            <FormLabel className="text-white/90">Description</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="text"
                placeholder="e.g., GitHub MCP Server"
                className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="enabled"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border border-white/20 bg-black/40 px-3 py-2">
            <div className="space-y-0.5">
              <FormLabel className="text-white/90">Enabled</FormLabel>
              <FormDescription className="text-white/60 text-xs">
                Disable to temporarily stop using this server without deleting it.
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value ?? true}
                onCheckedChange={(checked) => field.onChange(checked)}
                aria-label="Toggle server enabled state"
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
            <FormLabel className="text-white/90">Transport</FormLabel>
            <FormControl>
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none">
                  <SelectValue placeholder="Transport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamableHttp">HTTP (streamableHttp)</SelectItem>
                  <SelectItem value="stdio">Stdio (local process)</SelectItem>
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
              <FormLabel className="text-white/90">
                URL <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  placeholder="e.g., https://api.example.com/mcp/"
                  className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white font-mono text-sm focus:border-white/40 focus:outline-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {transport === "stdio" && (
        <>
          <FormField
            control={form.control}
            name="command"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/90">
                  Command <span className="text-red-400">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    placeholder="e.g., npx"
                    className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white font-mono text-sm focus:border-white/40 focus:outline-none"
                  />
                </FormControl>
                <FormDescription className="text-white/60 text-xs">
                  Provide the executable to launch (e.g., npx, uvx, python).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="args"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/90">Arguments</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                    rows={4}
                    className="text-white font-mono text-xs bg-black/40 border-white/20"
                  />
                </FormControl>
                <FormDescription className="text-white/60 text-xs">
                  One argument per line. Lines are passed to the command in order.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="advanced">
          <AccordionTrigger className="text-base font-medium text-white/90">
            Advanced Options
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4 pt-4">
            {transport === "streamableHttp" && (
              <FormField
                control={form.control}
                name="headers"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/90">Headers</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder='{"Authorization": "Bearer YOUR_TOKEN"}'
                        rows={4}
                        className="text-white font-mono text-xs bg-black/40 border-white/20"
                      />
                    </FormControl>
                    <FormDescription className="text-white/60 text-xs">
                      JSON format, e.g., Authorization headers
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {transport === "stdio" && (
              <FormField
                control={form.control}
                name="env"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/90">Environment Variables</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder='{"PATH": "/custom/bin"}'
                        rows={4}
                        className="text-white font-mono text-xs bg-black/40 border-white/20"
                      />
                    </FormControl>
                    <FormDescription className="text-white/60 text-xs">
                      JSON object of key/value pairs merged into the process environment.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="version"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/90">Version</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="text"
                      placeholder="e.g., 1.0.0"
                      className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
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
                  <FormLabel className="text-white/90">Timeout (ms)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : "")}
                      type="number"
                      placeholder="60000"
                      className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}

type McpServerFormWrapperProps = {
  initialData?: MCPServerConfig;
  isEditing: boolean;
  onSubmit: (data: MCPServerConfig) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
};

export function McpServerFormWrapper({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  isLoading,
}: McpServerFormWrapperProps) {
  const form = useForm<MCPServerFormData>({
    resolver: zodResolver(mcpServerSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      transport: initialData?.transport || "streamableHttp",
      url: initialData?.url || "",
      headers: initialData?.headers ? JSON.stringify(initialData.headers, null, 2) : "",
      command: initialData?.command || "",
      args: initialData?.args ? initialData.args.join("\n") : "",
      env: initialData?.env ? JSON.stringify(initialData.env, null, 2) : "",
      version: initialData?.version || "",
      timeoutMs: initialData?.timeoutMs || undefined,
      enabled: initialData?.enabled ?? true,
    },
  });

  const handleFormSubmit = async (data: MCPServerFormData) => {
    const baseConfig: MCPServerConfig = {
      name: data.name.trim(),
      transport: data.transport,
      description: data.description?.trim() || undefined,
      version: data.version?.trim() || undefined,
      timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
      enabled: data.enabled ?? true,
    };

    if (data.transport === "streamableHttp") {
      let headers: Record<string, string> | undefined;
      if (data.headers?.trim()) {
        try {
          headers = JSON.parse(data.headers);
        } catch {
          form.setError("headers", { message: "Invalid JSON format" });
          return;
        }
      }

      const config: MCPServerConfig = {
        ...baseConfig,
        url: data.url?.trim() || undefined,
        headers,
      };

      await onSubmit(config);
      return;
    }

    let env: Record<string, string> | undefined;
    if (data.env?.trim()) {
      try {
        env = JSON.parse(data.env);
      } catch {
        form.setError("env", { message: "Invalid JSON format" });
        return;
      }
    }

    const args = data.args
      ? data.args
          .split(/\r?\n/)
          .map((arg) => arg.trim())
          .filter(Boolean)
      : undefined;

    const config: MCPServerConfig = {
      ...baseConfig,
      command: data.command?.trim() || undefined,
      args,
      env,
    };

    await onSubmit(config);
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col gap-4">
        <h3 className="text-white text-xl font-semibold">
          {isEditing ? "Edit Server" : "Add New Server"}
        </h3>

        <McpServerForm form={form} />

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-800/80 hover:text-white/80"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Server"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

export type { MCPServerFormData };
