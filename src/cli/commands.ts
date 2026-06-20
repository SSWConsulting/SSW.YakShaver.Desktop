import {
  optionalString,
  type ParsedArgs,
  parseKeyValueList,
  repeatedStrings,
  requireString,
} from "./args";

/** A resolved request the CLI should issue against the bridge. */
export interface CommandRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
  /** Short human label used when pretty-printing the result. */
  label: string;
  /**
   * When set, the CLI must first resolve this MCP server NAME to an id (via
   * `GET /mcp/servers`) and substitute it for the `{id}` placeholder in `path`
   * before issuing the request. Kept out of {@link buildRequest} so that
   * function stays pure (no fetch); the runtime resolution lives in index.ts.
   */
  resolveName?: string;
}

/** Placeholder substituted with a resolved server id when `resolveName` is set. */
export const ID_PLACEHOLDER = "{id}";

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
    return buildMcpRequest(action, rest, options, parsed);
  }
  if (group === "config") {
    return buildConfigRequest(action, rest, options);
  }

  throw new UsageError(`Unknown command: ${[group, action].filter(Boolean).join(" ")}`);
}

/**
 * Resolve the stdio `args` array from the CLI flags.
 *
 * Prefers the repeatable `--arg <value>` form (one value per flag, each
 * preserved VERBATIM so a single argument may contain spaces, e.g. a path like
 * `/My Documents/server.js`). Falls back to the legacy single `--args "a b c"`
 * form, which splits on whitespace and therefore CANNOT express an argument
 * containing a space. The two forms are mutually exclusive.
 *
 * Returns `undefined` when neither flag is given (so the field is omitted and
 * any existing value is preserved on update).
 */
function resolveStdioArgs(
  options: Record<string, string | boolean>,
  parsed: Pick<ParsedArgs, "repeated">,
): string[] | undefined {
  const repeated = repeatedStrings(parsed, "arg");
  const argsValue = optionalString(options, "args");

  if (repeated && argsValue !== undefined) {
    throw new UsageError(
      'Use either repeatable --arg <value> (preserves spaces) or a single --args "a b c", not both.',
    );
  }

  if (repeated) return repeated;
  if (argsValue !== undefined) return argsValue.split(" ").filter(Boolean);
  return undefined;
}

function buildMcpRequest(
  action: string | undefined,
  rest: string[],
  options: Record<string, string | boolean>,
  parsed: Pick<ParsedArgs, "repeated">,
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
          args: resolveStdioArgs(options, parsed),
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
      const target = resolveTarget(rest[0], options, "remove <id> | --name <name>");
      return {
        ...target,
        method: "DELETE",
        path: `/mcp/servers/${target.idSegment}`,
        label: "Removed MCP server",
      };
    }

    case "enable": {
      const target = resolveTarget(rest[0], options, "enable <id> | --name <name> [--off]");
      const enabled = options.off !== true;
      return {
        ...target,
        method: "POST",
        path: `/mcp/servers/${target.idSegment}/enabled`,
        body: { enabled },
        label: enabled ? "Enabled MCP server" : "Disabled MCP server",
      };
    }

    case "update": {
      const target = resolveTarget(
        rest[0],
        options,
        "update <id> | --name <name> [--url ... | --command ... | --args ... | --env ... | --header ... | --transport ...]",
      );
      const body = buildMcpPatch(options, target.usedNameForLookup, parsed);
      return {
        ...target,
        method: "PUT",
        path: `/mcp/servers/${target.idSegment}`,
        body,
        label: "Updated MCP server",
      };
    }

    default:
      throw new UsageError(`Unknown mcp subcommand: ${action ?? "(none)"}`);
  }
}

/**
 * Resolve the server target for `remove`/`enable`/`update`.
 *
 * The selector is EITHER a positional id OR `--name <name>` (resolved to an id
 * at runtime via the bridge). When a positional id is given, `--name` is free to
 * act as a rename field on `update` (see {@link buildMcpPatch}); when no
 * positional id is given, `--name` IS the selector and is consumed for lookup.
 */
function resolveTarget(
  positionalId: string | undefined,
  options: Record<string, string | boolean>,
  usage: string,
): { idSegment: string; resolveName?: string; usedNameForLookup: boolean } {
  const name = optionalString(options, "name");

  if (positionalId) {
    // id is the selector; --name (if any) is a value to apply, not a lookup.
    return { idSegment: encodeURIComponent(positionalId), usedNameForLookup: false };
  }
  if (name) {
    return { idSegment: ID_PLACEHOLDER, resolveName: name, usedNameForLookup: true };
  }
  throw new UsageError(`Usage: yakshaver mcp ${usage}`);
}

/**
 * Build the merge-update body for `mcp update`. Includes ONLY the fields the
 * user actually provided so unspecified fields are preserved server-side.
 *
 * `--name` is reserved for server lookup when used as a selector, so we only
 * treat `--name` as a rename when it was NOT consumed to resolve the target.
 */
function buildMcpPatch(
  options: Record<string, string | boolean>,
  nameUsedForLookup: boolean,
  parsed: Pick<ParsedArgs, "repeated">,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (!nameUsedForLookup) {
    const name = optionalString(options, "name");
    if (name !== undefined) patch.name = name;
  }

  const description = optionalString(options, "description");
  if (description !== undefined) patch.description = description;

  const transport = optionalString(options, "transport");
  if (transport !== undefined) {
    const normalized = transport === "http" ? "streamableHttp" : transport;
    if (normalized !== "stdio" && normalized !== "streamableHttp") {
      throw new UsageError("--transport must be one of: stdio, http (streamableHttp)");
    }
    patch.transport = normalized;
  }

  const url = optionalString(options, "url");
  if (url !== undefined) patch.url = url;

  const command = optionalString(options, "command");
  if (command !== undefined) patch.command = command;

  const args = resolveStdioArgs(options, parsed);
  if (args !== undefined) patch.args = args;

  const env = parseKeyValueList(optionalString(options, "env"));
  if (env !== undefined) patch.env = env;

  const headers = parseKeyValueList(optionalString(options, "header"));
  if (headers !== undefined) patch.headers = headers;

  if (Object.keys(patch).length === 0) {
    throw new UsageError(
      "No fields to update. Provide at least one of --name/--description/--url/--command/--args/--env/--header/--transport",
    );
  }
  return patch;
}

function buildConfigRequest(
  action: string | undefined,
  rest: string[],
  options: Record<string, string | boolean>,
): CommandRequest {
  const target = rest[0] ?? "settings"; // default to settings

  if (action === "get") {
    if (target === "llm" || target === "orchestrator") {
      // The LLM config carries `orchestrationBackend`; `get orchestrator` is an
      // alias that surfaces the same payload.
      return { method: "GET", path: "/llm/config", label: "LLM config" };
    }
    if (target === "settings") {
      return { method: "GET", path: "/settings", label: "User settings" };
    }
    throw new UsageError("Usage: yakshaver config get [llm|orchestrator|settings]");
  }

  if (action === "set") {
    if (target === "orchestrator") {
      const backend = requireString(options, "backend");
      if (backend !== "openai" && backend !== "local-claude") {
        throw new UsageError("--backend must be one of: openai, local-claude");
      }
      return {
        method: "POST",
        path: "/llm/config/orchestrator",
        body: { orchestrationBackend: backend },
        label: "Updated orchestration backend",
      };
    }
    if (target === "settings") {
      const body = buildSettingsPatch(options);
      return { method: "PATCH", path: "/settings", body, label: "Updated settings" };
    }
    if (target === "llm") {
      throw new UsageError(
        "Setting the full LLM config via the CLI is not supported (it requires secrets). " +
          "Configure providers in the app UI, or set the orchestrator with " +
          "`config set orchestrator --backend <openai|local-claude>`.",
      );
    }
    throw new UsageError(
      "Usage: yakshaver config set [settings --<key> <value> | orchestrator --backend <openai|local-claude>]",
    );
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
