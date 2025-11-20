import { MCPServerManager } from "../mcp-server-manager.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";
import { createInternalSampleNumbersServer } from "./sample-numbers-server.js";
import { createInternalVideoToolsServer } from "./video-tools-server.js";

type InternalServerFactory = () => Promise<InternalMcpServerRegistration>;

const internalServerFactories: InternalServerFactory[] = [
  createInternalVideoToolsServer,
  createInternalSampleNumbersServer,
];
export async function registerAllInternalMcpServers(): Promise<void> {
  for (const factory of internalServerFactories) {
    try {
      const { config, clientTransport } = await factory();
      MCPServerManager.registerInternalServer(config, clientTransport);
    } catch (error) {
      console.error("Error registering internal MCP server:", error);
    }
  }
}
