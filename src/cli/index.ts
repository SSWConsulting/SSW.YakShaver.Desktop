#!/usr/bin/env node
import { parseArgs } from "./args";
import { BridgeClient, BridgeUnavailableError } from "./bridge-client";
import { buildRequest, type CommandRequest, ID_PLACEHOLDER, UsageError } from "./commands";
import { resolveServerIdByName } from "./resolve-name";

const HELP = `yakshaver — configure YakShaver Desktop from the terminal

USAGE
  yakshaver <command> [options]

The desktop app must be running; the CLI talks to it over a localhost-only,
token-authenticated bridge.

MCP
  yakshaver mcp list
  yakshaver mcp add --name <name> --transport stdio --command <cmd> [--arg <a> --arg <b>] [--env "K=V,K2=V2"]
  yakshaver mcp add --name <name> --transport http  --url <url> [--header "K=V"]
  yakshaver mcp update <id> [--name ... --url ... --command ... --arg ... --env ... --header ... --transport ...]
  yakshaver mcp remove <id>
  yakshaver mcp enable <id> [--off]        # --off disables instead of enabling

  remove/enable/update also accept --name <name> instead of a positional <id>
  (resolved against the server list; errors if the name is missing or ambiguous).

  stdio args: pass --arg once per argument (repeatable) to preserve spaces,
  e.g. --arg "/My Documents/server.js". For an argument that itself starts with
  "--", use the = form (--arg=--port). The legacy --args "a b c" form splits on
  whitespace and cannot express an argument that contains a space; the two forms
  are mutually exclusive. Built-in servers cannot be modified or removed.

CONFIG
  yakshaver config get [llm|orchestrator|settings]   # defaults to settings
  yakshaver config set settings --tool-approval-mode <yolo|wait|ask>
  yakshaver config set settings --open-at-login <true|false>
  yakshaver config set orchestrator --backend <openai|local-claude>

GLOBAL
  --dev      Target the dev build (YakShaverDev) userData
  --json     Print raw JSON instead of pretty output
  -h, --help Show this help

Secrets (api keys, header/env values) are always redacted in output.`;

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.options.help || parsed.positionals.length === 0) {
    console.log(HELP);
    return parsed.positionals.length === 0 && !parsed.options.help ? 1 : 0;
  }

  let request: CommandRequest;
  try {
    request = buildRequest(parsed);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}\n`);
      console.error(HELP);
      return 2;
    }
    throw err;
  }

  const client = new BridgeClient({ dev: parsed.options.dev === true });

  try {
    const path = await resolvePath(client, request);
    const data = await client.request(request.method, path, request.body);
    printResult(request.label, data, parsed.options.json === true);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      return 2;
    }
    if (err instanceof BridgeUnavailableError) {
      console.error(err.message);
      return 3;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

/**
 * If the request targets an MCP server by name, resolve the name to a concrete
 * id via `GET /mcp/servers` and substitute it into the path. Otherwise return
 * the path unchanged. Throws a {@link UsageError} on 0 or >1 matches.
 */
async function resolvePath(client: BridgeClient, request: CommandRequest): Promise<string> {
  if (!request.resolveName) return request.path;
  const servers = await client.get<unknown[]>("/mcp/servers");
  const id = resolveServerIdByName(servers, request.resolveName);
  return request.path.replace(ID_PLACEHOLDER, encodeURIComponent(id));
}

function printResult(label: string, data: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Pretty-print MCP server lists as a compact table-ish summary.
  if (Array.isArray(data)) {
    console.log(`${label} (${data.length}):`);
    for (const item of data) {
      printServerLine(item);
    }
    return;
  }

  if (label.startsWith("Added") || label.startsWith("Removed") || label.includes("MCP server")) {
    console.log(`${label}:`);
    printServerLine(data);
    return;
  }

  console.log(`${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

function printServerLine(item: unknown): void {
  if (!item || typeof item !== "object") {
    console.log(`  ${JSON.stringify(item)}`);
    return;
  }
  const s = item as Record<string, unknown>;
  const enabled = s.enabled === false ? "disabled" : "enabled";
  const target = s.url ?? s.command ?? "";
  const builtin = s.builtin ? " [builtin]" : "";
  console.log(
    `  - ${String(s.name ?? "(unnamed)")} [${String(s.transport ?? "?")}] (${enabled})${builtin}` +
      `\n      id: ${String(s.id ?? "?")}` +
      (target ? `\n      ${s.url ? "url" : "command"}: ${String(target)}` : ""),
  );
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
