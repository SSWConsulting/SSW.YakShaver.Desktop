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
yakshaver mcp add --name <name> --transport stdio --command <cmd> [--arg <a> --arg <b> ...] [--env "K=V,K2=V2"]
yakshaver mcp add --name <name> --transport http  --url <url>      [--header "K=V"]
yakshaver mcp remove <id>
yakshaver mcp enable <id> [--off]   # without --off enables; --off disables
```

- `--transport` accepts `stdio` or `http` (aliased to the internal `streamableHttp`).
- **Launch args (`stdio`): use `--arg` (repeatable), not `--args`.** `--arg` is the
  primary, robust mechanism — it is repeatable and each value is taken **verbatim**, so a
  single argument may contain spaces (a Windows path like `--arg "C:\My Tools\server.js"`).
  A value that itself begins with `--` must use the equals form, e.g.
  `--arg=--config="My File.json"`. The legacy `--args "a b c"` is a single
  **space-separated** string that's split on spaces and therefore **cannot express an
  individual argument that contains a space** — use it only for the trivial, space-free
  case. The two are **mutually exclusive**; passing both is a usage error.
- `--env` and `--header` are **comma-separated** `KEY=VALUE` lists (e.g. `--env "A=1,B=2"`).
- `mcp remove` and `mcp enable` select the target server by its positional **id** (get the
  id from `yakshaver mcp list`). There is no `--name` selector for remove/enable in this
  CLI surface — always look up the id with `mcp list` first.
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

To keep the literal PAT out of shell history and the process table (see the secrets
guardrail), set it in an environment variable first and reference it in the header rather
than typing the token inline:

```bash
export GITHUB_PAT="<USER_PROVIDED_PAT>"   # not persisted to history if you prefer; clear afterward
yakshaver mcp add \
  --name "GitHub" \
  --transport http \
  --url "https://api.githubcopilot.com/mcp/" \
  --header "Authorization=Bearer $GITHUB_PAT"
yakshaver mcp list          # confirm it appears
```

### Add a stdio MCP server (e.g. Azure DevOps via npx)

Pass each launch argument as a separate repeatable `--arg` (verbatim, space-safe) rather
than the legacy space-splitting `--args`:

```bash
yakshaver mcp add \
  --name "Azure DevOps" \
  --transport stdio \
  --command "npx" \
  --arg "-y" \
  --arg "@azure-devops/mcp" \
  --arg "<your-org>" \
  --arg=--authentication \
  --arg "pat" \
  --env "PERSONAL_ACCESS_TOKEN=$ADO_PAT_B64"
```

(Set `export ADO_PAT_B64="<USER_PROVIDED_BASE64_EMAIL_COLON_PAT>"` first so the literal token
isn't typed into the command line — see the secrets guardrail. Clear your history afterward.)

(Use `--arg=--authentication` — the equals form — because the value begins with `--`; a
bare `--arg --authentication` would be parsed as two flags.)

**Get the auth wiring from the official docs — don't invent it.** The example above is the
Microsoft `@azure-devops/mcp` server, which selects its auth method with the
`--authentication` / `-a` flag (one of `interactive | azcli | envvar | pat`), **not** an
arbitrary `*_PAT` env var. With no `--authentication` flag it defaults to **interactive
browser login**, which fails in a headless Claude Code context — so a non-interactive setup
must pass the flag explicitly:

- `--authentication pat` reads `PERSONAL_ACCESS_TOKEN`, which must be the **base64 encoding of
  `<email>:<pat>`** (the email can be any non-empty string).
- `--authentication envvar` reads a **raw bearer token** from `ADO_MCP_AUTH_TOKEN` (handy in
  CI).

Confirm the exact org, package, flag, and env var with the user against the server's own
getting-started doc
(<https://github.com/microsoft/azure-devops-mcp/blob/main/docs/GETTINGSTARTED.md>) before
running this — never guess the env var name (see the "Never invent values" guardrail).

### List / inspect

```bash
yakshaver mcp list                  # pretty: name [transport] (enabled/disabled), id, url/command
yakshaver mcp list --json           # raw JSON for parsing
yakshaver config get settings       # current user settings
yakshaver config get llm            # LLM config (keys redacted, hasApiKey booleans)
```

### Enable / disable a server

Select the server by its **id** — run `yakshaver mcp list` first to find it (the list shows
each server's name alongside its id).

```bash
yakshaver mcp list                     # find the id for "Jira"
yakshaver mcp enable <id>              # enable by id
yakshaver mcp enable <id> --off        # disable by id
```

### Change the tool-approval mode

```bash
yakshaver config set settings --tool-approval-mode wait   # one of: yolo | wait | ask
```

### Remove a server

```bash
yakshaver mcp list                  # find the id for the server to remove
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
- **Inline secrets in `--header` / `--env` leak into shell history and the process table.**
  A PAT or token typed directly into a `yakshaver mcp add` command line (e.g.
  `--header "Authorization=Bearer <PAT>"`, `--env "PERSONAL_ACCESS_TOKEN=<PAT>"`) is
  persisted to the operator's shell history (`.bash_history` / PSReadLine) and is visible to
  other processes on the host (`ps`, `/proc/<pid>/cmdline`) for the lifetime of the command.
  Prefer routing credential-bearing setup through the app's **Settings UI**, where the bridge
  redacts secrets (mirroring the unsupported `config set llm`). If you must use the CLI,
  reference the secret from an environment variable rather than typing the literal token
  (e.g. set `$GITHUB_PAT` first, then `--header "Authorization=Bearer $GITHUB_PAT"`), and
  warn the user to clear their shell history afterward.
- **The orchestration-backend toggle (#908) is NOT settable via the CLI yet.** `config set
  settings` only supports `--tool-approval-mode` and `--open-at-login`. For orchestration
  mode, tell the user to change it in the app's Settings.
- **Confirm before removing.** `mcp remove <id>` is destructive — show the user which server
  (name + id, from `mcp list`) you're about to remove and get confirmation first.
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
