import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";

/**
 * Registry that keeps track of in-memory MCP transports for built-in servers.
 * Each internal server registers its client transport with a unique ID so
 * the MCP client can retrieve it when establishing a connection.
 */
export namespace InternalMcpTransportRegistry {
  const clientTransports = new Map<string, InMemoryTransport>();

  export function registerClientTransport(id: string, transport: InMemoryTransport): void {
    clientTransports.set(id, transport);
  }

  export function getClientTransport(id: string): InMemoryTransport {
    const transport = clientTransports.get(id);
    if (!transport) {
      throw new Error(`No in-memory transport registered for id '${id}'`);
    }
    return transport;
  }
}
