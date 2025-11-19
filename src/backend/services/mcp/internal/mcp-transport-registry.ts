import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import type { MCPServerClient } from "../mcp-server-client";

type InMemoryTransportPair = [clientTransport: any, serverTransport: any];

/**
 * Registry for in-memory MCP server transports.
 * Allows registering custom in-memory MCP servers that can be used without external processes.
 */
export class InternalMcpTransportRegistry {
  private static transports = new Map<string, InMemoryTransportPair>();
  private static clients = new Map<string, any>();

  /**
   * Register an in-memory MCP server transport
   * @param serverId - Unique identifier for the server
   * @param transport - The InMemoryTransport pair [clientTransport, serverTransport]
   */
  public static registerTransport(serverId: string, transport: InMemoryTransportPair): void {
    this.transports.set(serverId, transport);
  }

  /**
   * Get a client for an in-memory MCP server
   * @param serverId - The server identifier
   * @returns An MCP client connected to the in-memory server
   */
  public static async getClientTransport(serverId: string): Promise<any> {
    if (this.clients.has(serverId)) {
      return this.clients.get(serverId);
    }

    const transport = this.transports.get(serverId);
    if (!transport) {
      throw new Error(`In-memory MCP server '${serverId}' not found in registry`);
    }

    const client = await experimental_createMCPClient({
      transport: transport[0], // Client transport is first element of tuple
    });

    this.clients.set(serverId, client);
    return client;
  }

  /**
   * Get the server transport for an in-memory MCP server
   * @param serverId - The server identifier
   * @returns The server transport
   */
  public static getServerTransport(serverId: string): any {
    const transport = this.transports.get(serverId);
    if (!transport) {
      throw new Error(`In-memory MCP server '${serverId}' not found in registry`);
    }
    return transport[1]; // Server transport is second element of tuple
  }

  /**
   * List all registered in-memory server IDs
   */
  public static listServerIds(): string[] {
    return Array.from(this.transports.keys());
  }

  /**
   * Check if a server ID is registered
   */
  public static hasServer(serverId: string): boolean {
    return this.transports.has(serverId);
  }
}
