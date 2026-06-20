---
name: yakshaver-config
description: Configure YakShaver Desktop's MCP servers and supported settings by driving the `yakshaver` terminal CLI, which talks to the running app over its localhost-only, token-authenticated bridge (127.0.0.1:8765). Use when the user asks Claude Code to set up / add / remove / enable / disable an MCP server for YakShaver Desktop (GitHub, Azure DevOps, Jira, or a custom stdio/HTTP server), to inspect its MCP or LLM/settings config, or to change a supported setting such as the tool-approval mode. Trigger on phrases like "add a GitHub MCP server to YakShaver", "connect YakShaver to Azure DevOps", "list YakShaver's MCP servers", "disable the Jira server", "set YakShaver's tool-approval mode to wait", or "/yakshaver-config".
---

# Configure YakShaver Desktop (yakshaver CLI)

> **⚠️ Availability: this skill is INERT until the `yakshaver` CLI lands.** It documents and
> drives the `yakshaver` CLI introduced by PR #910 (`src/cli/**` + the localhost config
> bridge), which is **not yet merged to `main`**. Until #910 is merged (or you are on a branch
> that includes `src/cli/**`), there is no `dist/cli/index.js` to build and no `yakshaver`
> command on PATH — the Prerequisites below will fail with *command not found* / missing
> `dist/cli/index.js`. **Before running any command in this skill, verify the CLI exists**
> (e.g. `yakshaver --help`, or `test -f dist/cli/index.js`); if it doesn't, tell the user the
> CLI hasn't shipped yet and stop — do not fall back to editing config files by hand.

Drive the `yakshaver` CLI to configure YakShaver Desktop's MCP servers and supported
settings from the terminal. The CLI does NOT touch config files directly — it talks to
the **running desktop app** over a localhost-only, token-authenticated HTTP bridge, so
the app must be running and every change goes through the same services the app's own UI
uses (no duplicated logic, shared Zod validation, secrets redacted).

This skill depends on the `yakshaver` CLI introduced by PR #910 (`src/cli/**`), which must be
merged before the skill is usable (see the availability note above).

## What this skill is for

Use it when the user asks Claude Code to:

- **Add / remove an MCP server** for YakShaver Desktop — a backlog provider (GitHub,
  Azure DevOps, Jira) or any custom stdio / HTTP (streamable-HTTP) MCP server.
- **List / inspect** the configured MCP servers, the LLM config, or user settings.
- **Enable / disable** an existing MCP server.
- **Change a supported setting** (tool-approval mode, open-at-login).

If the request is about something the CLI can't do (see Guardrails — e.g. setting LLM API
keys, or the orchestration backend toggle from #908), say so and direct the user to the
app's Settings UI instead of guessing.

## Prerequisites — check these FIRST

1. **YakShaver Desktop must be RUNNING.** The CLI reads a token file the app writes at
   startup and connects to the app's bridge. If the app is not running (or the bridge is
   disabled), every command exits **3** and prints:

   > `YakShaver Desktop doesn't appear to be running (or the CLI bridge is disabled). Start the app and retry.`

   When you see exit code 3 or that message, **stop and surface it to the user** — ask
   them to start YakShaver Desktop, then retry. Do not try to edit config files as a
   workaround.

   - Token file: `userData/yakshaver-tokens/cli-bridge.json` (random 256-bit bearer token
     + the port; same-user readable, `mode 0o600`). `userData` is `%APPDATA%/YakShaver` on
     Windows, `~/Library/Application Support/YakShaver` on macOS, `$XDG_CONFIG_HOME`/`~/.config`
     under `YakShaver` on Linux. For a dev build it's `YakShaverDev` — pass `--dev`.
   - Bridge binds **127.0.0.1** only, tries port **8765**, falls back to an ephemeral port
     (recorded in the token file). It can be disabled with `YAKSHAVER_DISABLE_CLI_BRIDGE`.

2. **The `yakshaver` CLI must be built and available.** This requires PR #910 to be merged
   (or to be on a branch that includes `src/cli/**`) — see the availability note at the top.
   If `src/cli/` is absent, `npm run build` will **not** emit `dist/cli/index.js` and there is
   no `yakshaver` command; stop and tell the user the CLI hasn't shipped yet. Otherwise, from
   the repo root:

   ```bash
   npm run build      # emits dist/cli/index.js (with a node shebang)
   npm link           # exposes the `yakshaver` command on PATH
   ```

   If you can't / don't want to `npm link`, invoke it directly instead:

   ```bash
   node dist/cli/index.js <command> [options]
   ```

   Everywhere below that shows `yakshaver ...` you can substitute `node dist/cli/index.js ...`.

3. Confirm reachability with a harmless read before making changes:

   ```bash
   yakshaver mcp list
   ```

   If that succeeds the app is up and the bridge is working.

## Command reference

Global flags: `--dev` (target the dev build's `YakShaverDev` userData), `--json` (raw JSON
instead of pretty output), `-h` / `--help`. Exit codes: `0` ok, `1` runtime/request error,
`2` usage error, `3` app/bridge not reachable.

### MCP servers

```text
yakshaver mcp list
yakshaver mcp add --name <name> --transport stdio --command <cmd> [--args "a b c"] [--env "K=V,K2=V2"]
yakshaver mcp add --name <name> --transport http  --url <url>      [--header "K=V"]
yakshaver mcp remove <id>
yakshaver mcp enable <id> [--off]          # without --off enables; --off disables
```

- `--transport` accepts `stdio` or `http` (aliased to the internal `streamableHttp`).
- `--args` is a single **space-separated** string; it's split on spaces.
- `--env` and `--header` are **comma-separated** `KEY=VALUE` lists (e.g. `--env "A=1,B=2"`).
- `mcp remove <id>` and `mcp enable <id>` take the server **id** (a positional), not the
  name. Get the id from `yakshaver mcp list` first.
- `--description` is optional on `add`.

### Config (settings + LLM)

```text
yakshaver config get [llm|settings]        # defaults to "settings" if omitted
yakshaver config set settings --tool-approval-mode <yolo|wait|ask>
yakshaver config set settings --open-at-login <true|false>
```

- `config get llm` returns the LLM config with secrets redacted (see Guardrails).
- `config set settings` requires at least one of the supported keys above, otherwise it's a
  usage error. Multiple keys can be combined in one call.
- `config set llm` is intentionally **not supported** (it would require secrets) — the CLI
  tells you to configure providers in the app UI.

## Common workflows (concrete examples)

Always run `yakshaver mcp list` first so you know the current state and the server ids.

### Add a GitHub MCP server (HTTP / streamable-HTTP)

GitHub's hosted MCP server is HTTP-based and authenticated with a token header. Ask the
user for the real URL and token — never invent them.

```bash
yakshaver mcp add \
  --name "GitHub" \
  --transport http \
  --url "https://api.githubcopilot.com/mcp/" \
  --header "Authorization=Bearer <USER_PROVIDED_PAT>"
yakshaver mcp list          # confirm it appears
```

### Add a stdio MCP server (e.g. Azure DevOps via npx)

```bash
yakshaver mcp add \
  --name "Azure DevOps" \
  --transport stdio \
  --command "npx" \
  --args "-y @azure-devops/mcp <your-org>" \
  --env "AZURE_DEVOPS_PAT=<USER_PROVIDED_PAT>"
```

(Confirm the exact package / args with the user — the command, args, and env shown here are
placeholders.)

### List / inspect

```bash
yakshaver mcp list                  # pretty: name [transport] (enabled/disabled), id, url/command
yakshaver mcp list --json           # raw JSON for parsing
yakshaver config get settings       # current user settings
yakshaver config get llm            # LLM config (keys redacted, hasApiKey booleans)
```

### Enable / disable a server

```bash
yakshaver mcp enable <id>           # enable
yakshaver mcp enable <id> --off     # disable
```

### Change the tool-approval mode

```bash
yakshaver config set settings --tool-approval-mode wait   # one of: yolo | wait | ask
```

### Remove a server

```bash
yakshaver mcp list                  # find the id
yakshaver mcp remove <id>           # confirm with the user first (see Guardrails)
```

## Guardrails

- **Never invent values.** Do not make up server URLs, commands, package names, env vars,
  headers, tokens, or API keys. If you don't have a real value, **ask the user** for it.
- **Secrets are redacted by the bridge.** `config get llm` and `mcp list` return
  `***redacted***` for api keys, header values, and env values (and `hasApiKey` booleans).
  Don't expect `config get` to echo a key back — you can't read existing secrets through the
  CLI, only set new ones where supported.
- **Setting LLM secrets is not supported via the CLI.** `config set llm` errors on purpose —
  direct the user to the app's Settings UI to configure providers / API keys.
- **The orchestration-backend toggle (#908) is NOT settable via the CLI yet.** `config set
  settings` only supports `--tool-approval-mode` and `--open-at-login`. For orchestration
  mode, tell the user to change it in the app's Settings.
- **Confirm before removing.** `mcp remove <id>` is destructive — show the user which server
  (name + id) you're about to remove and get confirmation first.
- **Built-in servers.** `mcp list` marks built-ins with `[builtin]`; prefer
  enabling/disabling these over removing them, and check with the user.
- **App-not-running (exit 3).** Surface the friendly message and ask the user to start the
  app; don't fall back to editing config files by hand.

## Verifying a change

After any mutating command, re-run a read to confirm the app accepted it:

- After `mcp add` / `mcp remove` / `mcp enable`: `yakshaver mcp list`.
- After `config set settings ...`: `yakshaver config get settings`.

Because the bridge calls the same services the UI uses, changes should also be visible in the
running app's UI.
