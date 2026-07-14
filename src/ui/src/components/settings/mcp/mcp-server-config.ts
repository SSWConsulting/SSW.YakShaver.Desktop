import type { MCPServerConfig } from "@shared/types/mcp";
import { z } from "zod";

export const mcpServerSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(
        /^[a-zA-Z0-9_.-]+$/,
        "Only letters, numbers, underscores, hyphens, and dots allowed (no spaces)",
      )
      .refine((value) => !value.includes("__"), {
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
    if (data.transport === "streamableHttp" && !data.url?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "URL is required for HTTP transports",
      });
    }

    if (data.transport === "stdio" && !data.command?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["command"],
        message: "Command is required for stdio transports",
      });
    }
  });

export type MCPServerFormData = z.infer<typeof mcpServerSchema>;

export type MCPServerConfigField = keyof MCPServerFormData;

export type MCPServerConfigResult =
  | { success: true; config: MCPServerConfig }
  | { success: false; message: string; field?: MCPServerConfigField };

export type MCPServersConfigResult =
  | { success: true; configs: MCPServerConfig[] }
  | { success: false; message: string };

const serverNameSchema = mcpServerSchema.shape.name;

const stringRecordSchema = z.record(z.string(), z.string());

const jsonServerSchema = z.discriminatedUnion("transport", [
  z.object({
    name: serverNameSchema,
    description: z.string().optional(),
    transport: z.literal("streamableHttp"),
    url: z.url("Must be a valid URL"),
    headers: stringRecordSchema.optional(),
    version: z.string().optional(),
    timeoutMs: z.number().positive("Timeout must be greater than zero").optional(),
  }),
  z.object({
    name: serverNameSchema,
    description: z.string().optional(),
    transport: z.literal("stdio"),
    command: z.string().trim().min(1, "Command is required for stdio transports"),
    args: z.array(z.string()).optional(),
    env: stringRecordSchema.optional(),
    cwd: z.string().optional(),
    stderr: z.enum(["inherit", "ignore", "pipe"]).optional(),
  }),
]);

function sanitizeSegment(value: string): string {
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
}

function parseStringRecord(
  value: string | undefined,
  field: "headers" | "env",
): { success: true; value?: Record<string, string> } | { success: false; message: string } {
  if (!value?.trim()) {
    return { success: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      success: false,
      message: field === "headers" ? "Invalid JSON format" : "Invalid JSON object",
    };
  }

  const result = stringRecordSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      message:
        field === "headers"
          ? "Headers must be a JSON object with string values"
          : "Environment variables must be a JSON object with string values",
    };
  }

  return { success: true, value: result.data };
}

function parseArgs(
  value: string | undefined,
): { success: true; value?: string[] } | { success: false; message: string } {
  if (!value?.trim()) {
    return { success: true };
  }

  const rawArgs = value.trim();
  if (!rawArgs.startsWith("[")) {
    return {
      success: true,
      value: rawArgs.split(/\r?\n/).map(sanitizeSegment).filter(Boolean),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return { success: false, message: "Invalid JSON array" };
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return { success: false, message: "Args JSON must be an array of strings" };
  }

  return {
    success: true,
    value: parsed.map(sanitizeSegment).filter(Boolean),
  };
}

export function formDataToMcpServerConfig(data: MCPServerFormData, id = ""): MCPServerConfigResult {
  if (data.transport === "streamableHttp") {
    const headers = parseStringRecord(data.headers, "headers");
    if (!headers.success) {
      return { success: false, field: "headers", message: headers.message };
    }

    return {
      success: true,
      config: {
        id,
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        transport: "streamableHttp",
        url: data.url?.trim() ?? "",
        headers: headers.value,
        version: data.version?.trim() || undefined,
        timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
      },
    };
  }

  const args = parseArgs(data.args);
  if (!args.success) {
    return { success: false, field: "args", message: args.message };
  }

  const env = parseStringRecord(data.env, "env");
  if (!env.success) {
    return { success: false, field: "env", message: env.message };
  }

  return {
    success: true,
    config: {
      id,
      name: data.name.trim(),
      description: data.description?.trim() || undefined,
      transport: "stdio",
      command: sanitizeSegment(data.command ?? ""),
      args: args.value,
      env: env.value,
      cwd: data.cwd?.trim() || undefined,
      stderr: data.stderr && data.stderr !== "inherit" ? data.stderr : undefined,
    },
  };
}

export function mcpServerConfigToFormData(config?: MCPServerConfig): MCPServerFormData {
  return {
    name: config?.name ?? "",
    description: config?.description ?? "",
    transport: config?.transport ?? "streamableHttp",
    url: config?.transport === "streamableHttp" ? config.url : "",
    headers:
      config?.transport === "streamableHttp" && config.headers
        ? JSON.stringify(config.headers, null, 2)
        : "",
    version: config?.transport === "streamableHttp" ? (config.version ?? "") : "",
    timeoutMs:
      config?.transport === "streamableHttp" && typeof config.timeoutMs === "number"
        ? config.timeoutMs
        : "",
    command: config?.transport === "stdio" ? config.command : "",
    args: config?.transport === "stdio" && config.args?.length ? config.args.join("\n") : "",
    env: config?.transport === "stdio" && config.env ? JSON.stringify(config.env, null, 2) : "",
    cwd: config?.transport === "stdio" ? (config.cwd ?? "") : "",
    stderr: config?.transport === "stdio" ? (config.stderr ?? "inherit") : "inherit",
  };
}

function parseDraftJsonValue(value: string | undefined): unknown {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function formatMcpServerFormDraftJson(data: MCPServerFormData): string {
  const description = data.description?.trim() || undefined;

  if (data.transport === "streamableHttp") {
    return JSON.stringify(
      {
        name: data.name,
        description,
        transport: data.transport,
        url: data.url ?? "",
        headers: parseDraftJsonValue(data.headers),
        version: data.version?.trim() || undefined,
        timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : undefined,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      name: data.name,
      description,
      transport: data.transport,
      command: data.command ?? "",
      args: data.args?.trim().startsWith("[")
        ? parseDraftJsonValue(data.args)
        : data.args?.split(/\r?\n/).map(sanitizeSegment).filter(Boolean),
      env: parseDraftJsonValue(data.env),
      cwd: data.cwd?.trim() || undefined,
      stderr: data.stderr === "inherit" ? undefined : data.stderr,
    },
    null,
    2,
  );
}

function isJsonObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getJsonField(value: object, field: string): unknown {
  return Reflect.get(value, field);
}

function formatJsonValidationError(result: z.ZodError): string {
  const issue = result.issues[0];
  const path = issue.path.join(".");
  const fieldLabel =
    path === "url" ? "URL" : path ? `${path.charAt(0).toUpperCase()}${path.slice(1)}` : "";
  const messageAlreadyNamesField =
    fieldLabel && issue.message.toLowerCase().startsWith(fieldLabel.toLowerCase());

  return path && !messageAlreadyNamesField ? `${fieldLabel}: ${issue.message}` : issue.message;
}

function normalizeTransport(server: object): "streamableHttp" | "stdio" | undefined {
  const transport = getJsonField(server, "transport") ?? getJsonField(server, "type");
  if (transport === "streamableHttp" || transport === "http" || transport === "streamable-http") {
    return "streamableHttp";
  }
  if (transport === "stdio") {
    return "stdio";
  }
  if (typeof getJsonField(server, "command") === "string") {
    return "stdio";
  }
  if (typeof getJsonField(server, "url") === "string") {
    return "streamableHttp";
  }
  return undefined;
}

function parseServerObject(server: unknown, wrapperName?: string): MCPServerConfigResult {
  if (!isJsonObject(server)) {
    return { success: false, message: "Server configuration must be a JSON object" };
  }

  const configuredName = getJsonField(server, "name");
  const name =
    typeof configuredName === "string" && configuredName.trim() ? configuredName : wrapperName;
  if (!name) {
    return { success: false, message: "Name is required" };
  }

  const transport = normalizeTransport(server);
  if (!transport) {
    return {
      success: false,
      message: `Server '${name}' must provide either a command or URL`,
    };
  }

  if (transport === "streamableHttp" && !getJsonField(server, "url")) {
    return { success: false, message: `Server '${name}': URL is required for HTTP transports` };
  }
  if (transport === "stdio" && !getJsonField(server, "command")) {
    return {
      success: false,
      message: `Server '${name}': Command is required for stdio transports`,
    };
  }

  const normalized =
    transport === "streamableHttp"
      ? {
          name,
          description: getJsonField(server, "description"),
          transport,
          url: getJsonField(server, "url"),
          headers: getJsonField(server, "headers"),
          version: getJsonField(server, "version"),
          timeoutMs: getJsonField(server, "timeoutMs"),
        }
      : {
          name,
          description: getJsonField(server, "description"),
          transport,
          command: getJsonField(server, "command"),
          args: getJsonField(server, "args"),
          env: getJsonField(server, "env"),
          cwd: getJsonField(server, "cwd"),
          stderr: getJsonField(server, "stderr"),
        };

  const result = jsonServerSchema.safeParse(normalized);
  if (!result.success) {
    return {
      success: false,
      message: `Server '${name}': ${formatJsonValidationError(result.error)}`,
    };
  }

  return { success: true, config: { ...result.data, id: "" } };
}

export function parseMcpServersJson(json: string): MCPServersConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown syntax error";
    return { success: false, message: `Invalid JSON: ${detail}` };
  }

  if (!isJsonObject(parsed)) {
    return { success: false, message: "MCP configuration must be a JSON object" };
  }

  const wrappedServers = getJsonField(parsed, "mcpServers") ?? getJsonField(parsed, "servers");
  let serverEntries: ReadonlyArray<readonly [string | undefined, unknown]>;
  if (wrappedServers === undefined) {
    serverEntries = [[undefined, parsed]];
  } else {
    if (!isJsonObject(wrappedServers)) {
      return { success: false, message: "The servers container must be a JSON object" };
    }
    serverEntries = Object.keys(wrappedServers).map(
      (name) => [name, getJsonField(wrappedServers, name)] as const,
    );
  }

  if (serverEntries.length === 0) {
    return { success: false, message: "No MCP servers were found in the JSON" };
  }

  const configs: MCPServerConfig[] = [];
  for (const [wrapperName, server] of serverEntries) {
    const result = parseServerObject(server, wrapperName);
    if (!result.success) {
      return result;
    }
    configs.push(result.config);
  }

  const normalizedNames = configs.map((config) => config.name.toLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return { success: false, message: "MCP server names must be unique" };
  }

  return { success: true, configs };
}

export function formatMcpServerJson(config: MCPServerConfig): string {
  const { id: _id, ...jsonConfig } = config;
  return JSON.stringify(jsonConfig, null, 2);
}
