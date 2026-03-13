import type { MCPServerConfig } from "../types/mcp";

/**
 * IDs for well-known preset MCP servers.
 * These must stay in sync with the card components in the frontend.
 */
export const PRESET_SERVER_IDS = {
  GITHUB: "f12980ac-f80c-47e0-b4ac-181a54122d61",
  AZURE_DEVOPS: "483d49a4-0902-415a-a987-832a21bd3d63",
  JIRA: "0f03a50c-219b-46e9-9ce3-54f925c44479",
} as const;

/**
 * Default configs for preset MCP servers.
 * Included in listAvailableServers() even before the user connects.
 * Once a user saves a server with the same ID, the stored version takes precedence.
 */
export const PRESET_MCP_SERVERS: readonly MCPServerConfig[] = [
  {
    id: PRESET_SERVER_IDS.GITHUB,
    name: "GitHub",
    transport: "streamableHttp",
    url: "https://api.githubcopilot.com/mcp/",
    description: "GitHub MCP Server",
    toolWhitelist: [],
    enabled: false,
  },
  {
    id: PRESET_SERVER_IDS.AZURE_DEVOPS,
    name: "Azure_DevOps",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@azure-devops/mcp", "ssw2"],
    description: "Azure DevOps MCP Server",
    toolWhitelist: [],
    enabled: false,
  },
  {
    id: PRESET_SERVER_IDS.JIRA,
    name: "Jira",
    transport: "streamableHttp",
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Atlassian MCP Server",
    toolWhitelist: [],
    enabled: false,
  },
] as MCPServerConfig[];
