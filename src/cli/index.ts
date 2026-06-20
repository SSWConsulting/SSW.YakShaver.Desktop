#!/usr/bin/env node
import { ArgParseError, parseArgs } from "./args";
import { BridgeClient, BridgeUnavailableError } from "./bridge-client";
import { buildRequest, type CommandRequest, UsageError } from "./commands";
import { printResult } from "./print";

const HELP = `yakshaver — configure YakShaver Desktop from the terminal

USAGE
  yakshaver <command> [options]

The desktop app must be running; the CLI talks to it over a localhost-only,
token-authenticated bridge.

MCP
  yakshaver mcp list
  yakshaver mcp add --name <name> --transport stdio --command <cmd> [--arg <a> --arg <b> ...] [--env "K=V,K2=V2"]
  yakshaver mcp add --name <name> --transport http  --url <url> [--header "K=V"]
  yakshaver mcp remove <id>
  yakshaver mcp enable <id> [--off]        # --off disables instead of enabling

  Use --arg (repeatable) for each launch argument; each value is taken verbatim,
  so it may contain spaces, e.g. --arg "C:\\My Tools\\server.js", and it may even
  begin with -- (e.g. --arg --port --arg 3000). The legacy --args "a b c" splits
  on spaces and cannot express an argument that itself contains a space.

CONFIG
  yakshaver config get [llm|settings]      # defaults to settings
  yakshaver config set settings --tool-approval-mode <yolo|wait|ask>
  yakshaver config set settings --open-at-login <true|false>

GLOBAL
  --dev      Target the dev build (YakShaverDev) userData
  --json     Print raw JSON instead of pretty output
  -h, --help Show this help

Secrets (api keys, header/env values) are always redacted in output.`;

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgParseError) {
      console.error(`Error: ${err.message}\n`);
      console.error(HELP);
      return 2;
    }
    throw err;
  }

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

  // `--dev` forces the dev (YakShaverDev) build; without it we leave `dev`
  // unset so the client auto-detects by trying both prod and dev token files.
  const client = new BridgeClient({ dev: parsed.options.dev === true ? true : undefined });

  try {
    const data = await client.request(request.method, request.path, request.body);
    printResult(request.label, data, parsed.options.json === true);
    return 0;
  } catch (err) {
    if (err instanceof BridgeUnavailableError) {
      console.error(err.message);
      return 3;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
