import type { MCPServerConfig } from "../types/mcp";

/**
 * IDs for well-known preset MCP servers.
 */
export const PRESET_SERVER_IDS = {
  GITHUB: "f12980ac-f80c-47e0-b4ac-181a54122d61",
  AZURE_DEVOPS: "483d49a4-0902-415a-a987-832a21bd3d63",
  JIRA: "0f03a50c-219b-46e9-9ce3-54f925c44479",
} as const;

/** Default config for the GitHub preset MCP server. */
export const GITHUB_PRESET_CONFIG = {
  id: PRESET_SERVER_IDS.GITHUB,
  name: "GitHub",
  transport: "streamableHttp",
  url: "https://api.githubcopilot.com/mcp/",
  description: "GitHub MCP Server",
  toolWhitelist: [],
  enabled: false,
} satisfies MCPServerConfig;

/** Default config for the Azure DevOps preset MCP server. */
export const AZURE_DEVOPS_PRESET_CONFIG = {
  id: PRESET_SERVER_IDS.AZURE_DEVOPS,
  name: "Azure_DevOps", // MCP server names cannot contain spaces
  transport: "stdio",
  command: "npx",
  // TODO: need to be able to customize this last parameter
  // https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/547
  args: ["-y", "@azure-devops/mcp", "ssw2"],
  description: "Azure DevOps MCP Server",
  toolWhitelist: [],
  enabled: false,
} satisfies MCPServerConfig;

/** Default config for the Jira preset MCP server. */
export const JIRA_PRESET_CONFIG = {
  id: PRESET_SERVER_IDS.JIRA,
  name: "Jira",
  transport: "streamableHttp",
  url: "https://mcp.atlassian.com/v1/mcp",
  description: "Atlassian MCP Server",
  toolWhitelist: [],
  enabled: false,
} satisfies MCPServerConfig;

/**
 * All preset MCP server configs.
 * Included in listAvailableServers() even before the user connects.
 * Once a user saves a server with the same ID, the stored version takes precedence.
 */
export const PRESET_MCP_SERVERS: readonly MCPServerConfig[] = [
  GITHUB_PRESET_CONFIG,
  AZURE_DEVOPS_PRESET_CONFIG,
  JIRA_PRESET_CONFIG,
];
