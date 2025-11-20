import { experimental_createMCPClient, type experimental_MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolSet } from "ai";
import type { MCPServerConfig } from "./types";

interface CreateClientOptions {
  inMemoryClientTransport?: InMemoryTransport;
}

export class MCPServerClient {
  private mcpClient: experimental_MCPClient;

  private constructor(client: experimental_MCPClient) {
    this.mcpClient = client;
  }

  public static async createClientAsync(
    mcpConfig: MCPServerConfig,
    options: CreateClientOptions = {},
  ): Promise<MCPServerClient> {
    // create streamableHttp transport MCP client
    if (mcpConfig.transport === "streamableHttp") {
      const client = await experimental_createMCPClient({
        transport: {
          type: "http",
          url: mcpConfig.url,
          headers: mcpConfig.headers,
        },
      });
      return new MCPServerClient(client);
    }

    // create stdio transport MCP client
    if (mcpConfig.transport === "stdio") {
      const mcpClient = await experimental_createMCPClient({
        transport: new StdioClientTransport({
          command: mcpConfig.command,
          args: mcpConfig.args,
        }),
      });
      return new MCPServerClient(mcpClient);
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
      return new MCPServerClient(client);
    }

    throw new Error("Unsupported transport type");
  }

  public async listTools(): Promise<ToolSet> {
    return await this.mcpClient.tools();
  }

  public async disconnectAsync(): Promise<void> {
    await this.mcpClient.close();
  }
}
