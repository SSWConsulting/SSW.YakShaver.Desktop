import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import type { MCPServerConfig } from "../types.js";

/**
 * Registry that keeps track of in-memory MCP transports for built-in servers.
 * Each internal server registers its client transport with a unique ID so
 * the MCP client can retrieve it when establishing a connection.
 */
export namespace InternalMcpTransportRegistry {
  const clientTransports = new Map<string, InMemoryTransport>();
  const serverConfigs = new Map<string, MCPServerConfig>();

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

  export function registerServerConfig(config: MCPServerConfig): void {
    if (config.transport !== "inMemory" || !config.inMemoryServerId) {
      throw new Error("Only in-memory server configs can be registered");
    }
    serverConfigs.set(config.inMemoryServerId, config);
  }

  export function listServerConfigs(): MCPServerConfig[] {
    return Array.from(serverConfigs.values());
  }
}
