# Desktop Electron App

This is the YakShaver Desktop Electron app, designed to help you create the perfect PBI in 30 seconds, with built-in MCP support.

For more information, visit our website at [yakshaver.ai](https://yakshaver.ai)

We also offer a **web version** [YakShaver 360](https://360.yakshaver.ai)

## Prerequisites

- [Node JS](https://nodejs.org/en/download)

## Setup

1. Copy `.env.example` → `.env`
2. Copy environment from keeper: **SSW.Yakshaver Desktop .env** (just copy YouTube client id and secret values. LLM values should be set via app itself)

## Run
In the root folder, run
1. `npm install -g concurrently`, which will install the [`concurrently` package](https://www.npmjs.com/package/concurrently)
1. `npm run setup` – install dependencies
2. `npm run dev` – start the app

On Windows and macOS, `npm run setup` also installs the standalone `yt-dlp` binary used
for YouTube downloads. This avoids relying on the operating system's Python.

## Building

1. `npm run setup` – ensure all dependencies are installed
2. `npm run make` - this will create 2 folders

- `/out/make/{target}/{arch}` - which contains the installers/distributables for end users
- `/SSW.YakShaver-{system}-{arch}` - which contains the unpacked/portable app

## Configuration

- Keys are stored securely on your device using the operating system's encryption (Electron safeStorage) in the app's user data directory

- **Windows**: `%APPDATA%\SSW.YakShaver\yakshaver-tokens\*.enc`
- **macOS**: `~/Library/Application Support/SSW.YakShaver/yakshaver-tokens/*.enc`
- **Linux**: `~/.config/SSW.YakShaver/yakshaver-tokens/*.enc`


### OpenAI API Key (User-provided)

You can now set your own OpenAI API key directly in the app:

- Open the app and go to the main screen toolbar.
- Click the "LLM Settings" button.
- Paste your OpenAI API key (starts with `sk-...`) and Save.

Notes:

- You can clear the stored key anytime from the same dialog.

### MCP Server Configuration

The configuration file is automatically created when you add your first MCP server through the
Settings UI. The configuration persists across app restarts and updates.

When adding a custom MCP server, select **JSON** to paste a flat server configuration or a common
client configuration wrapper. Flat HTTP servers require `name`, `transport`, and `url`:

```json
{
  "name": "github",
  "description": "GitHub MCP Server",
  "transport": "streamableHttp",
  "url": "https://api.githubcopilot.com/mcp/",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Local process servers require `name`, `transport`, and `command`:

```json
{
  "name": "filesystem",
  "description": "Local filesystem MCP Server",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
  "env": {
    "NODE_ENV": "production"
  }
}
```

Optional HTTP fields are `description`, `headers`, `version`, and `timeoutMs`. Optional STDIO
fields are `description`, `args`, `env`, `cwd`, and `stderr` (`inherit`, `ignore`, or `pipe`).
Header and environment variable values must be strings. Switching back to **Form** maps the JSON
values to the corresponding fields without losing valid data.

The JSON importer also accepts common client configuration wrappers. Server names are taken from
the keys, and `transport` is inferred from `command` or `url` when it is omitted:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Both `mcpServers` (Claude-style) and `servers` (VS Code-style) wrappers are supported. Every entry
is shown in the import preview and added as a separate YakShaver MCP server. If any entry cannot
be parsed, the whole import is rejected rather than partially importing the configuration.

## Running macOS Compiled App (`YakShaver.app`)

To run this app, you'll need to disable Apple's Gatekeeper quarantine attribute.
After dragging YakShaver.app to the Applications folder, run 
```
xattr -d com.apple.quarantine /Applications/YakShaver.app
```
in your terminal.

#### Template

The template used for this repo is from the [SSW.GitHub.Template](https://github.com/SSWConsulting/SSW.GitHub.Template) repo.

# 📓Architecture Decision Records
We use ADRs to track important architectural changes. See the full history in [/docs/adr](./docs/adr/README.md)
