import { experimental_createMCPClient, type experimental_MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { formatErrorMessage } from "../../utils/error-utils";
import { authorizeWithBackend } from "./mcp-oauth";
import { expandHomePath, sanitizeSegment } from "./mcp-utils";
import type { MCPServerConfig } from "./types";
import "dotenv/config";
import type { ToolSet } from "ai";
import { withTimeout } from "../../utils/async-utils";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

export interface CreateClientOptions {
  inMemoryClientTransport?: InMemoryTransport;
}

export class MCPServerClient {
  public mcpClientName: string;
  public mcpClientId: string;

  private mcpClient: experimental_MCPClient;

  private constructor(id: string, name: string, client: experimental_MCPClient) {
    this.mcpClientId = id;
    this.mcpClientName = name;
    this.mcpClient = client;
  }

  public static async createClientAsync(
    mcpConfig: MCPServerConfig,
    options: CreateClientOptions = {},
  ): Promise<MCPServerClient> {
    // create streamableHttp transport MCP client
    if (mcpConfig.transport === "streamableHttp") {
      const serverUrl = expandHomePath(mcpConfig.url);

      // Don't use OAuth for built-in MCP server
      if (mcpConfig.builtin) {
        const client = await experimental_createMCPClient({
          transport: {
            type: "http",
            url: serverUrl,
            headers: mcpConfig.headers,
          },
        });
        return new MCPServerClient(mcpConfig.id, mcpConfig.name, client);
      }

      const serverId = mcpConfig.id;
      const tokenStorage = McpOAuthTokenStorage.getInstance();

      // Check if we already have tokens
      let tokens = await tokenStorage.getTokensAsync(serverId);
      console.log(
        `[MCPServerClient] Tokens for ${mcpConfig.name}:`,
        tokens ? "Present" : "Missing",
      );

      // TODO: Need to implement refresh token logic here if the token is stale - https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/580
      if (tokens) {
        // Tokens exist - use Bearer header directly, bypass SDK OAuth
        console.log(`[MCPServerClient] Using existing tokens for ${mcpConfig.name}`);
        const client = await experimental_createMCPClient({
          transport: {
            type: "http",
            url: serverUrl,
            headers: {
              ...mcpConfig.headers,
              Authorization: `Bearer ${tokens.access_token}`,
            },
          },
        });
        return new MCPServerClient(mcpConfig.id, mcpConfig.name, client);
      }

      // No tokens - trigger backend OAuth flow
      try {
        const authTimeoutMs = Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 60000);
        console.log(
          `[MCPServerClient] Initiating backend OAuth for ${mcpConfig.name} at ${serverUrl} (Timeout: ${authTimeoutMs}ms)`,
        );

        // This call will delegate discovery and DCR to the backend
        await withTimeout(
          authorizeWithBackend(tokenStorage, serverUrl, serverId, authTimeoutMs),
          authTimeoutMs,
          `${mcpConfig.name} OAuth`,
        );

        // After OAuth, get tokens and use headers
        tokens = await tokenStorage.getTokensAsync(serverId);
        if (!tokens) {
          throw new Error(`OAuth completed but no tokens found for ${mcpConfig.name}`);
        }

        console.log(`[MCPServerClient] Creating MCP client for ${mcpConfig.name} with Bearer token`);
        const client = await experimental_createMCPClient({
          transport: {
            type: "http",
            url: serverUrl,
            headers: {
              ...mcpConfig.headers,
              Authorization: `Bearer ${tokens.access_token}`,
            },
          },
        });
        return new MCPServerClient(mcpConfig.id, mcpConfig.name, client);
      } catch (authError) {
        console.error(
          `[MCPServerClient]: OAuth flow failed for ${mcpConfig.name}. Error:`,
          authError,
        );
        console.log(`[MCPServerClient]: Falling back to headers for ${mcpConfig.name}`);
      }

      // Fallback: Use headers if OAuth is not supported or failed
      const client = await experimental_createMCPClient({
        transport: {
          type: "http",
          url: serverUrl,
          headers: mcpConfig.headers,
        },
      });
      return new MCPServerClient(mcpConfig.id, mcpConfig.name, client);
    }

    // create stdio transport MCP client
    if (mcpConfig.transport === "stdio") {
      if (!mcpConfig.command?.trim()) {
        throw new Error(
          "Unsupported transport configuration: 'command' is required for stdio transports",
        );
      }
      const command = sanitizeSegment(mcpConfig.command);
      const args = mcpConfig.args
        ?.map((arg) => sanitizeSegment(arg))
        .filter((arg) => arg.length > 0);
      const cwd = mcpConfig.cwd ? expandHomePath(mcpConfig.cwd) : undefined;
      const mcpClient = await experimental_createMCPClient({
        transport: new StdioClientTransport({
          command,
          args,
          env: mcpConfig.env,
          stderr: mcpConfig.stderr,
          cwd,
        }),
      });
      return new MCPServerClient(mcpConfig.id, mcpConfig.name, mcpClient);
    }

    // create inMemory transport MCP client
    if (mcpConfig.transport === "inMemory") {
      const clientTransport = options.inMemoryClientTransport;
      if (!clientTransport) {
        throw new Error(
          `Missing in-memory transport for MCP server '${mcpConfig.name}'. Ensure it is registered before use.`,
        );
      }
      const client = await experimental_createMCPClient({
        transport: clientTransport,
      });
      return new MCPServerClient(mcpConfig.id, mcpConfig.name, client);
    }

    throw new Error(`Unsupported transport type: ${mcpConfig}`);
  }

  public async listToolsAsync(): Promise<ToolSet> {
    const ToolList: ToolSet = (await this.mcpClient.tools()) as ToolSet;
    return ToolList;
  }

  public async listToolsWithServerPrefixAsync(): Promise<ToolSet> {
    const rawTools = await this.listToolsAsync();
    const prefixedTools: ToolSet = {};

    // rename the key with server name prefix
    for (const [toolName, data] of Object.entries(rawTools)) {
      const sanitizedServerName = this.mcpClientName.replace(/\s+/g, "_");
      const prefixedName = `${sanitizedServerName}__${toolName}`;
      prefixedTools[prefixedName] = data;
    }
    return prefixedTools;
  }

  public async toolCountAsync(): Promise<number> {
    try {
      const tools = await this.listToolsAsync();
      if (Array.isArray(tools)) {
        return tools.length;
      } else {
        return Object.keys(tools).length;
      }
    } catch (error) {
      throw new Error(
        `Failed to get tool count from MCP server: ${this.mcpClientName}. Error: ${formatErrorMessage(error)}`,
      );
    }
  }

  public async healthCheckAsync(): Promise<{ healthy: boolean; toolCount: number }> {
    try {
      const toolCount = await this.toolCountAsync();
      return { healthy: true, toolCount: toolCount };
    } catch {
      return { healthy: false, toolCount: 0 };
    }
  }

  public async disconnectAsync(): Promise<void> {
    await this.mcpClient.close();
  }
}
