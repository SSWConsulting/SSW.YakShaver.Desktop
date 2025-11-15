import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Registry that keeps track of in-memory MCP transports for built-in servers.
 * Each internal server registers its client transport with a unique ID so
 * {@link MCPClientWrapper} can retrieve it when establishing a connection.
 */
export class InternalMcpTransportRegistry {
  private static clientTransports = new Map<string, InMemoryTransport>();

  static registerClientTransport(id: string, transport: InMemoryTransport): void {
    this.clientTransports.set(id, transport);
  }

  static getClientTransport(id: string): InMemoryTransport {
    const transport = this.clientTransports.get(id);
    if (!transport) {
      throw new Error(`No in-memory transport registered for id '${id}'`);
    }
    return transport;
  }
}

