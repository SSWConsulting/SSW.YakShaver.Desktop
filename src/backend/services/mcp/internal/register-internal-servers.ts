import { MCPServerManager } from "../mcp-server-manager.js";
import { createInternalFillTemplateServer } from "./fill-template-server.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";
import { createInternalTemplateToolsServer } from "./template-tools-server.js";
import { createInternalVideoToolsServer } from "./video-tools-server.js";

type InternalServerFactory = () => Promise<InternalMcpServerRegistration>;

const internalServerFactories: InternalServerFactory[] = [
  createInternalVideoToolsServer,
  // createInternalTemplateToolsServer,
  createInternalFillTemplateServer,
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
