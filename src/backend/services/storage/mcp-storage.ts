import { join } from "node:path";
import type { MCPServerConfig } from "../mcp/types";
import { BaseSecureStorage } from "./base-secure-storage";

const MCP_CONFIG_FILE = "mcp-servers.enc";

export class McpStorage extends BaseSecureStorage {
  private static instance: McpStorage;

  private constructor() {
    super();
  }

  public static getInstance(): McpStorage {
    if (!McpStorage.instance) {
      McpStorage.instance = new McpStorage();
    }
    return McpStorage.instance;
  }

  private getMcpConfigPath(): string {
    return join(this.storageDir, MCP_CONFIG_FILE);
  }

  async storeMcpServers(servers: MCPServerConfig[]): Promise<void> {
    await this.encryptAndStore(this.getMcpConfigPath(), { servers });
  }

  async getMcpServers(): Promise<MCPServerConfig[]> {
    const data = await this.decryptAndLoad<{ servers: MCPServerConfig[] }>(this.getMcpConfigPath());
    return data?.servers || [];
  }

  async hasMcpServers(): Promise<boolean> {
    return await this.fileExists(this.getMcpConfigPath());
  }
}
