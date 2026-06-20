import {
  optionalString,
  optionalStringArray,
  type ParsedArgs,
  parseKeyValueList,
  requireString,
} from "./args";

/** A resolved request the CLI should issue against the bridge. */
export interface CommandRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
  /** Short human label used when pretty-printing the result. */
  label: string;
}

/**
 * Translate parsed CLI args into a bridge request.
 *
 * Pure and side-effect free (no fetch, no fs) so the routing/validation logic is
 * unit-testable in isolation. Throws on bad usage with a clear message.
 */
export function buildRequest(parsed: ParsedArgs): CommandRequest {
  const [group, action, ...rest] = parsed.positionals;
  const { options } = parsed;

  if (group === "mcp") {
    return buildMcpRequest(action, rest, options, parsed.multiOptions);
  }
  if (group === "config") {
    return buildConfigRequest(action, rest, options);
  }

  throw new UsageError(`Unknown command: ${[group, action].filter(Boolean).join(" ")}`);
}

function buildMcpRequest(
  action: string | undefined,
  rest: string[],
  options: Record<string, string | boolean>,
  multiOptions: Record<string, string[]>,
): CommandRequest {
  switch (action) {
    case "list":
      return { method: "GET", path: "/mcp/servers", label: "MCP servers" };

    case "add": {
      const transport = requireString(options, "transport");
      if (transport !== "stdio" && transport !== "streamableHttp" && transport !== "http") {
        throw new UsageError(`--transport must be one of: stdio, http (streamableHttp)`);
      }
      const name = requireString(options, "name");
      const description = optionalString(options, "description");

      if (transport === "stdio") {
        const command = requireString(options, "command");
        const body = {
          name,
          description,
          transport: "stdio" as const,
          command,
          args: parseStdioArgs(options, multiOptions),
          env: parseKeyValueList(optionalString(options, "env")),
        };
        return { method: "POST", path: "/mcp/servers", body, label: "Added MCP server" };
      }

      // http / streamableHttp
      const url = requireString(options, "url");
      const body = {
        name,
        description,
        transport: "streamableHttp" as const,
        url,
        headers: parseKeyValueList(optionalString(options, "header")),
      };
      return { method: "POST", path: "/mcp/servers", body, label: "Added MCP server" };
    }

    case "remove": {
      const id = rest[0];
      if (!id) throw new UsageError("Usage: yakshaver mcp remove <id>");
      return {
        method: "DELETE",
        path: `/mcp/servers/${encodeURIComponent(id)}`,
        label: "Removed MCP server",
      };
    }

    case "enable": {
      const id = rest[0];
      if (!id) throw new UsageError("Usage: yakshaver mcp enable <id> [--off]");
      const enabled = options.off !== true;
      return {
        method: "POST",
        path: `/mcp/servers/${encodeURIComponent(id)}/enabled`,
        body: { enabled },
        label: enabled ? "Enabled MCP server" : "Disabled MCP server",
      };
    }

    default:
      throw new UsageError(`Unknown mcp subcommand: ${action ?? "(none)"}`);
  }
}

/**
 * Resolve the stdio launch argv for `mcp add`.
 *
 * `--arg` is the primary, robust mechanism: it is repeatable and each value is
 * taken verbatim, so a single argument may contain spaces (a Windows path like
 * `--arg "C:\My Tools\server.js"`, or `--arg "--config=My File.json"`). The
 * legacy `--args "a b c"` form is kept only as a convenience for the trivial,
 * space-free case — it splits on spaces and therefore CANNOT express an
 * individual argument that contains a space. The two are mutually exclusive to
 * avoid silently merging an ambiguous mix.
 */
function parseStdioArgs(
  options: Record<string, string | boolean>,
  multiOptions: Record<string, string[]>,
): string[] | undefined {
  const repeatable = optionalStringArray(multiOptions, "arg");
  const joined = optionalString(options, "args");

  if (repeatable && joined !== undefined) {
    throw new UsageError(
      "Use either --arg (repeatable, supports spaces) or --args (space-separated), not both",
    );
  }

  if (repeatable) {
    return repeatable;
  }

  if (joined !== undefined) {
    const split = joined.split(" ").filter(Boolean);
    return split.length > 0 ? split : undefined;
  }

  return undefined;
}

function buildConfigRequest(
  action: string | undefined,
  rest: string[],
  options: Record<string, string | boolean>,
): CommandRequest {
  const target = rest[0] ?? "settings"; // default to settings

  if (action === "get") {
    if (target === "llm") {
      return { method: "GET", path: "/llm/config", label: "LLM config" };
    }
    if (target === "settings") {
      return { method: "GET", path: "/settings", label: "User settings" };
    }
    throw new UsageError("Usage: yakshaver config get [llm|settings]");
  }

  if (action === "set") {
    if (target === "settings") {
      const body = buildSettingsPatch(options);
      return { method: "PATCH", path: "/settings", body, label: "Updated settings" };
    }
    if (target === "llm") {
      throw new UsageError(
        "Setting the full LLM config via the CLI is not supported (it requires secrets). " +
          "Configure providers in the app UI.",
      );
    }
    throw new UsageError("Usage: yakshaver config set settings --<key> <value>");
  }

  throw new UsageError(`Unknown config subcommand: ${action ?? "(none)"}`);
}

function buildSettingsPatch(options: Record<string, string | boolean>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const toolApprovalMode = optionalString(options, "tool-approval-mode");
  if (toolApprovalMode !== undefined) {
    patch.toolApprovalMode = toolApprovalMode;
  }

  if (options["open-at-login"] !== undefined) {
    patch.openAtLogin = coerceBoolean(options["open-at-login"]);
  }

  if (Object.keys(patch).length === 0) {
    throw new UsageError(
      "No settings provided. Try --tool-approval-mode <yolo|wait|ask> or --open-at-login <true|false>",
    );
  }
  return patch;
}

function coerceBoolean(value: string | boolean): boolean {
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1" || value === "yes";
}

/** A usage/validation error (distinct from runtime/bridge errors). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
