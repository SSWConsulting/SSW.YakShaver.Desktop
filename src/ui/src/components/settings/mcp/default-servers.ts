import type { MCPServerConfig } from "./McpServerForm";

export const DEFAULT_SERVERS: MCPServerConfig[] = [
  {
    name: "GitHub",
    description: "GitHub MCP Server",
    url: "https://mcp.ssw.com.au/github",
    transport: "streamableHttp",
  },
  {
    name: "Jira",
    description: "Jira MCP Server",
    url: "https://mcp.ssw.com.au/github",
    transport: "streamableHttp",
  },
];
