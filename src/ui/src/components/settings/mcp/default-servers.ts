import type { MCPServerConfig } from "./McpServerForm";

export const DEFAULT_SERVERS: MCPServerConfig[] = [
  {
    name: "GitHub",
    description: "GitHub MCP Server",
    url: "https://api.githubcopilot.com/mcp",
    transport: "streamableHttp",
  },
  {
    name: "Jira",
    description: "Jira MCP Server",
    url: "https://mcp.atlassian.com/v1/mcp",
    transport: "streamableHttp",
  },
];
