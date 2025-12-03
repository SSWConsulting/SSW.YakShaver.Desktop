import { experimental_createMCPClient, type experimental_MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolSet } from "ai";
import getPort from "get-port";
import { getGitHubMcpCredentials } from "../../config/env";
import { withTimeout } from "../../utils/async-utils";
import { formatErrorMessage } from "../../utils/error-utils";
import {
  authorizeWithPkceOnce,
  checkDynamicRegistrationSupport,
  InMemoryOAuthClientProvider,
  waitForAuthorizationCode,
} from "./mcp-oauth";
import { MCPUtils } from "./mcp-utils";
import type { MCPServerConfig } from "./types";

export interface CreateClientOptions {
  inMemoryClientTransport?: InMemoryTransport;
}

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

      // Check for dynamic client registration support for servers
      let oauthEndpoint: string | null = null;
      try {
        oauthEndpoint = await checkDynamicRegistrationSupport(serverUrl);
      } catch (detectionError) {
        console.warn(
          `[MCPServerClient]: Dynamic registration detection failed for ${mcpConfig.name}: ${formatErrorMessage(detectionError)}`,
        );
      }

      if (oauthEndpoint) {
        const callbackPort = await getPort({ port: Number(process.env.MCP_CALLBACK_PORT) });
        const authProvider = new InMemoryOAuthClientProvider({
          callbackPort,
        });
        const authTimeoutMs = Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 60000);
        await withTimeout(
          authorizeWithPkceOnce(authProvider, serverUrl, () =>
            waitForAuthorizationCode(callbackPort),
          ),
          authTimeoutMs,
          `${mcpConfig.name} OAuth`,
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

      if (!oauthEndpoint && mcpConfig.url.includes("https://api.githubcopilot.com/mcp")) {
        const githubCredentials = await getGitHubMcpCredentials();
        const callbackPort = Number(process.env.MCP_CALLBACK_PORT ?? 8090);

        if (githubCredentials) {
          const authProvider = new InMemoryOAuthClientProvider({
            clientId: githubCredentials.clientId,
            clientSecret: githubCredentials.clientSecret,
            callbackPort,
          });
          const authTimeoutMs = Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 60000);
          await withTimeout(
            authorizeWithPkceOnce(authProvider, serverUrl, () =>
              waitForAuthorizationCode(callbackPort),
            ),
            authTimeoutMs,
            `${mcpConfig.name} OAuth`,
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

  public async listToolsAsync(): Promise<ToolSet> {
    const raw = await this.mcpClient.tools();

    return raw as ToolSet;
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
