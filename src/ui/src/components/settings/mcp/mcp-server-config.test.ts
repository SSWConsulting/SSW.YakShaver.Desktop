import { describe, expect, it } from "vitest";
import {
  findDuplicateMcpServerName,
  formatMcpServerFormDraftJson,
  formatMcpServerJson,
  formDataToMcpServerConfig,
  type MCPServerConfigResult,
  mcpServerConfigToFormData,
  parseMcpServersJson,
} from "./mcp-server-config";

function parseSingleServer(json: string): MCPServerConfigResult {
  const result = parseMcpServersJson(json);
  if (!result.success) {
    return result;
  }
  if (result.configs.length !== 1) {
    return { success: false, message: "Expected exactly one MCP server" };
  }
  return { success: true, config: result.configs[0] };
}

describe("MCP server JSON configuration", () => {
  it("finds names that collide with servers hidden from the Settings list", () => {
    expect(
      findDuplicateMcpServerName(
        ["Internal_Tools", "GitHub"],
        [
          {
            id: "",
            name: "internal_tools",
            transport: "stdio",
            command: "npx",
          },
        ],
      ),
    ).toBe("internal_tools");
  });

  it("finds duplicate names within a batch import", () => {
    expect(
      findDuplicateMcpServerName(
        [],
        [
          { id: "", name: "first", transport: "stdio", command: "npx" },
          { id: "", name: "FIRST", transport: "stdio", command: "node" },
        ],
      ),
    ).toBe("FIRST");
  });

  it("parses and validates an HTTP server", () => {
    const result = parseSingleServer(`{
      "name": "github",
      "description": "GitHub MCP Server",
      "transport": "streamableHttp",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }`);

    expect(result).toEqual({
      success: true,
      config: {
        id: "",
        name: "github",
        description: "GitHub MCP Server",
        transport: "streamableHttp",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer YOUR_TOKEN" },
      },
    });
  });

  it("reports JSON syntax errors", () => {
    const result = parseSingleServer('{ "name": "github"');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain("Invalid JSON");
    }
  });

  it("does not repeat a field name in validation messages", () => {
    const result = parseSingleServer(`{
      "name": "",
      "transport": "streamableHttp",
      "url": ""
    }`);

    expect(result).toEqual({ success: false, message: "Name is required" });
  });

  it.each([
    ["Name is required", '{ "transport": "streamableHttp", "url": "https://example.com/mcp" }'],
    [
      "Server 'example': URL is required for HTTP transports",
      '{ "name": "example", "transport": "streamableHttp" }',
    ],
    [
      "Server 'example': Command is required for stdio transports",
      '{ "name": "example", "transport": "stdio" }',
    ],
  ])("reports a clear required-field error: %s", (message, json) => {
    const result = parseSingleServer(json);

    expect(result).toEqual({ success: false, message });
  });

  it("infers an HTTP transport from a URL", () => {
    const result = parseSingleServer('{ "name": "example", "url": "https://example.com/mcp" }');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.transport).toBe("streamableHttp");
    }
  });

  it("preserves stdio data through JSON and form mode synchronization", () => {
    const parsed = parseSingleServer(`{
      "name": "filesystem",
      "description": "Local files",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": { "NODE_ENV": "production" },
      "cwd": "C:\\\\workspace",
      "stderr": "pipe"
    }`);

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    const formData = mcpServerConfigToFormData(parsed.config);
    const synchronized = formDataToMcpServerConfig(formData);

    expect(synchronized).toEqual(parsed);
    if (!synchronized.success) {
      return;
    }
    expect(parseSingleServer(formatMcpServerJson(synchronized.config))).toEqual(parsed);
  });

  it("preserves a single double-quote character as an argument", () => {
    const result = formDataToMcpServerConfig({
      name: "quotes",
      description: "",
      transport: "stdio",
      url: "",
      headers: "",
      version: "",
      timeoutMs: "",
      command: "node",
      args: '"',
      env: "",
      cwd: "",
      stderr: "inherit",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.transport).toBe("stdio");
      if (result.config.transport === "stdio") {
        expect(result.config.args).toEqual(['"']);
      }
    }
  });

  it("preserves explicit empty and quoted arguments in a JSON array", () => {
    const result = formDataToMcpServerConfig({
      name: "exact-args",
      description: "",
      transport: "stdio",
      url: "",
      headers: "",
      version: "",
      timeoutMs: "",
      command: "node",
      args: '["", "  spaced  ", "\\""]',
      env: "",
      cwd: "",
      stderr: "inherit",
    });

    expect(result.success).toBe(true);
    if (result.success && result.config.transport === "stdio") {
      expect(result.config.args).toEqual(["", "  spaced  ", '"']);
    }
  });

  it("rejects non-string header and environment values", () => {
    const httpResult = parseSingleServer(`{
      "name": "http",
      "transport": "streamableHttp",
      "url": "https://example.com/mcp",
      "headers": { "X-Retry": 3 }
    }`);
    const stdioResult = parseSingleServer(`{
      "name": "stdio",
      "transport": "stdio",
      "command": "npx",
      "env": { "DEBUG": true }
    }`);

    expect(httpResult.success).toBe(false);
    expect(stdioResult.success).toBe(false);
  });

  it("imports every server from a Claude-style mcpServers object", () => {
    const result = parseMcpServersJson(`{
      "mcpServers": {
        "playwright": {
          "command": "npx",
          "args": ["@playwright/mcp@latest"]
        },
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
        }
      }
    }`);

    expect(result).toEqual({
      success: true,
      configs: [
        {
          id: "",
          name: "playwright",
          transport: "stdio",
          command: "npx",
          args: ["@playwright/mcp@latest"],
        },
        {
          id: "",
          name: "filesystem",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
      ],
    });
  });

  it("imports VS Code servers and normalizes the HTTP type", () => {
    const result = parseMcpServersJson(`{
      "servers": {
        "github": {
          "type": "http",
          "url": "https://api.githubcopilot.com/mcp"
        }
      }
    }`);

    expect(result).toEqual({
      success: true,
      configs: [
        {
          id: "",
          name: "github",
          transport: "streamableHttp",
          url: "https://api.githubcopilot.com/mcp",
        },
      ],
    });
  });

  it("fails the whole import when any wrapped server cannot be parsed", () => {
    const result = parseMcpServersJson(`{
      "mcpServers": {
        "playwright": { "command": "npx" },
        "unknown": { "args": ["package"] }
      }
    }`);

    expect(result).toEqual({
      success: false,
      message: "Server 'unknown' must provide either a command or URL",
    });
  });

  it("serializes the current form draft instead of keeping stale JSON", () => {
    const json = formatMcpServerFormDraftJson({
      name: "draft-server",
      description: "",
      transport: "streamableHttp",
      url: "https://example.com/mcp",
      headers: "not valid nested JSON yet",
      version: "",
      timeoutMs: "",
      command: "",
      args: "",
      env: "",
      cwd: "",
      stderr: "inherit",
    });

    expect(JSON.parse(json)).toMatchObject({
      name: "draft-server",
      url: "https://example.com/mcp",
      headers: "not valid nested JSON yet",
    });
  });
});
