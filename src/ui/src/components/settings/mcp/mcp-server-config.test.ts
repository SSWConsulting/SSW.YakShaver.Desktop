import { describe, expect, it } from "vitest";
import {
  formatMcpServerJson,
  formDataToMcpServerConfig,
  mcpServerConfigToFormData,
  parseMcpServerJson,
  parseMcpServersJson,
} from "./mcp-server-config";

describe("MCP server JSON configuration", () => {
  it("parses and validates an HTTP server", () => {
    const result = parseMcpServerJson(`{
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
    const result = parseMcpServerJson('{ "name": "github"');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain("Invalid JSON");
    }
  });

  it("does not repeat a field name in validation messages", () => {
    const result = parseMcpServerJson(`{
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
    const result = parseMcpServerJson(json);

    expect(result).toEqual({ success: false, message });
  });

  it("infers an HTTP transport from a URL", () => {
    const result = parseMcpServerJson('{ "name": "example", "url": "https://example.com/mcp" }');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.transport).toBe("streamableHttp");
    }
  });

  it("preserves stdio data through JSON and form mode synchronization", () => {
    const parsed = parseMcpServerJson(`{
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
    expect(parseMcpServerJson(formatMcpServerJson(synchronized.config))).toEqual(parsed);
  });

  it("rejects non-string header and environment values", () => {
    const httpResult = parseMcpServerJson(`{
      "name": "http",
      "transport": "streamableHttp",
      "url": "https://example.com/mcp",
      "headers": { "X-Retry": 3 }
    }`);
    const stdioResult = parseMcpServerJson(`{
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
});
