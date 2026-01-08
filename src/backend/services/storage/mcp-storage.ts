import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

  async getMcpServerConfigsAsync(): Promise<MCPServerConfig[]> {
    const path = this.getMcpConfigPath();
    const data = await this.decryptAndLoad<{ servers: unknown[] }>(path);
    const raw = (data?.servers ?? []) as Array<Record<string, unknown>>;

    let changed = false;
    const upgraded = raw.map((server) => {
      if (typeof server.id === "string" && server.id.length > 0) {
        return server;
      }
      changed = true;
      return { ...server, id: randomUUID() };
    });

    if (changed) {
      await this.encryptAndStore(path, { servers: upgraded });
    }

    return upgraded as unknown as MCPServerConfig[];
  }

  async hasMcpServersAsync(): Promise<boolean> {
    return await this.fileExists(this.getMcpConfigPath());
  }
}
