import { experimental_createMCPClient, type experimental_MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { formatErrorMessage } from "../../utils/error-utils";
import { MCPUtils } from "./mcp-utils";
import type { MCPServerConfig } from "./types";
import { InMemoryOAuthClientProvider, authorizeWithPkceOnce, waitForAuthorizationCode } from "./mcp-oauth";
import "dotenv/config";

export interface CreateClientOptions {
  inMemoryClientTransport?: InMemoryTransport;
}

// Minimal tool interface based on MCP spec; allows additional provider-specific fields.
export interface MCPTool {
  name: string;
  description?: string;
  input_schema?: unknown;
  // Allow arbitrary extra metadata without forcing any.
  [key: string]: unknown;
}

// A tool set can be an array or an object keyed by tool name.
export type MCPToolSet = MCPTool[] | Record<string, MCPTool>;

export class MCPServerClient {
  public mcpClientName: string;
  private mcpClient: experimental_MCPClient;

  private constructor(name: string, client: experimental_MCPClient) {
    this.mcpClientName = name;
    this.mcpClient = client;
  }

  public static async createClientAsync(
    mcpConfig: MCPServerConfig,
    options: CreateClientOptions = {},
  ): Promise<MCPServerClient> {
    // create streamableHttp transport MCP client
    if (mcpConfig.transport === "streamableHttp") {
      const serverUrl = MCPUtils.expandHomePath(mcpConfig.url);

      // Don't use OAuth for built-in MCP server
      if (mcpConfig.builtin) {
        const client = await experimental_createMCPClient({
          transport: {
            type: "http",
            url: serverUrl,
            headers: mcpConfig.headers,
          },
        });
        return new MCPServerClient(mcpConfig.name, client);
      }

      // Currently support OAuth for GitHub MCP server
      if (mcpConfig.url.includes("https://api.githubcopilot.com/mcp")) {
        const githubClientId = process.env.GITHUB_MCP_CLIENT_ID;
        const githubClientSecret = process.env.GITHUB_MCP_CLIENT_SECRET;
        const callbackPort = Number(process.env.MCP_CALLBACK_PORT ?? 8090);

        if (githubClientId && githubClientSecret) {
          const authProvider = new InMemoryOAuthClientProvider({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            callbackPort,
          });
          await authorizeWithPkceOnce(authProvider, serverUrl, () =>
            waitForAuthorizationCode(callbackPort),
          );
          const client = await experimental_createMCPClient({
            transport: {
              type: "http",
              url: serverUrl,
              authProvider,
            },
          });
          return new MCPServerClient(mcpConfig.name, client);
        }
      }

      // Fallback: Use headers if no OAuth is configured
      const client = await experimental_createMCPClient({
        transport: {
          type: "http",
          url: serverUrl,
          headers: mcpConfig.headers,
        },
      });
      return new MCPServerClient(mcpConfig.name, client);
    }

    // create stdio transport MCP client
    if (mcpConfig.transport === "stdio") {
      if (!mcpConfig.command?.trim()) {
        throw new Error(
          "Unsupported transport configuration: 'command' is required for stdio transports",
        );
      }
      const command = MCPUtils.sanitizeSegment(mcpConfig.command);
      const args = mcpConfig.args
        ?.map((arg) => MCPUtils.sanitizeSegment(arg))
        .filter((arg) => arg.length > 0);
      const cwd = mcpConfig.cwd ? MCPUtils.expandHomePath(mcpConfig.cwd) : undefined;
      const mcpClient = await experimental_createMCPClient({
        transport: new StdioClientTransport({
          command,
          args,
          env: mcpConfig.env,
          stderr: mcpConfig.stderr,
          cwd,
        }),
      });
      return new MCPServerClient(mcpConfig.name, mcpClient);
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
      return new MCPServerClient(mcpConfig.name, client);
    }

    throw new Error(`Unsupported transport type: ${mcpConfig}`);
  }

  public async listToolsAsync(): Promise<MCPToolSet> {
    const raw = await this.mcpClient.tools();
    return raw as MCPToolSet;
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
