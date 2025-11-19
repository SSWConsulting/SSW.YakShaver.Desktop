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
import { Textarea } from "../../ui/textarea";

export type Transport = "streamableHttp" | "stdio";

type MCPHttpServerConfig = {
  name: string;
  description?: string;
  transport: "streamableHttp";
  url: string;
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
};

type MCPStdioServerConfig = {
  name: string;
  description?: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: "inherit" | "ignore" | "pipe";
};

export type MCPServerConfig = MCPHttpServerConfig | MCPStdioServerConfig;

const mcpServerSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(/^[a-zA-Z0-9 _-]+$/, "Only letters, numbers, spaces, underscores, and hyphens allowed"),
    description: z.string().optional(),
    transport: z.enum(["streamableHttp", "stdio"]),
    url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
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
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "URL is required for HTTP transports",
        });
      }
    }

    if (data.transport === "stdio") {
      if (!data.command || !data.command.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
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
        name="transport"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-white/90">
              Transport <span className="text-red-400">*</span>
            </FormLabel>
            <FormControl>
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none">
                  <SelectValue placeholder="Transport" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamableHttp">HTTP (streamableHttp)</SelectItem>
                  <SelectItem value="stdio">STDIO (local process)</SelectItem>
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
                  className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <Accordion type="single" collapsible>
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
                          onChange={(event) =>
                            field.onChange(event.target.value ? Number(event.target.value) : "")
                          }
                          type="number"
                          placeholder="60000"
                          className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
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
                      <FormLabel className="text-white/90">Arguments</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          placeholder={`-y\n@modelcontextprotocol/server-filesystem\n.`}
                          className="text-white font-mono text-xs bg-black/40 border-white/20"
                        />
                      </FormControl>
                      <FormDescription className="text-white/60 text-xs">
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
                      <FormLabel className="text-white/90">Environment Variables</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          placeholder='{"NODE_ENV": "production"}'
                          className="text-white font-mono text-xs bg-black/40 border-white/20"
                        />
                      </FormControl>
                      <FormDescription className="text-white/60 text-xs">
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
                      <FormLabel className="text-white/90">Working Directory</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="text"
                          placeholder="Optional working directory"
                          className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none"
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
                      <FormLabel className="text-white/90">stderr Handling</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value ?? "inherit"}>
                          <SelectTrigger className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white focus:border-white/40 focus:outline-none">
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
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      transport: initialData?.transport ?? "streamableHttp",
      url: initialData?.transport === "streamableHttp" ? initialData?.url ?? "" : "",
      headers:
        initialData?.transport === "streamableHttp" && initialData?.headers
          ? JSON.stringify(initialData.headers, null, 2)
          : "",
      version: initialData?.transport === "streamableHttp" ? initialData?.version ?? "" : "",
      timeoutMs:
        initialData?.transport === "streamableHttp" && typeof initialData?.timeoutMs === "number"
          ? initialData.timeoutMs
          : "",
      command: initialData?.transport === "stdio" ? initialData?.command ?? "" : "",
      args:
        initialData?.transport === "stdio" && initialData?.args?.length
          ? initialData.args.join("\n")
          : "",
      env:
        initialData?.transport === "stdio" && initialData?.env
          ? JSON.stringify(initialData.env, null, 2)
          : "",
      cwd: initialData?.transport === "stdio" ? initialData?.cwd ?? "" : "",
      stderr: initialData?.transport === "stdio" ? initialData?.stderr ?? "inherit" : "inherit",
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

        if (!parsedHeaders || typeof parsedHeaders !== "object" || Array.isArray(parsedHeaders)) {
          form.setError("headers", { message: "Headers must be a JSON object" });
          return;
        }

        const headerEntries = Object.entries(parsedHeaders);
        if (!headerEntries.every(([, value]) => typeof value === "string")) {
          form.setError("headers", { message: "Header values must be strings" });
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
        timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
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
        (result.startsWith("\"") && result.endsWith("\"")) ||
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
          if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
            form.setError("args", { message: "Args JSON must be an array of strings" });
            return;
          }
          args = parsed.map((segment) => sanitizeSegment(segment)).filter((segment) => segment);
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
          form.setError("env", { message: "Environment values must be strings" });
          return;
        }
        env = Object.fromEntries(entries) as Record<string, string>;
      } catch {
        form.setError("env", { message: "Invalid JSON object" });
        return;
      }
    }

    const stderr = data.stderr && data.stderr !== "inherit" ? data.stderr : undefined;
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
          <Button variant="secondary" type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Server"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
