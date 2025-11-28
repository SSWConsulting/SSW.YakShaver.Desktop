import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { MCPServerConfig } from "../types.js";

export interface InternalMcpServerRegistration {
  config: MCPServerConfig;
  clientTransport: InMemoryTransport;
}
