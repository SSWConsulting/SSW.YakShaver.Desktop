import { join } from "node:path";
import type { MCPToolControlSettings } from "../mcp/types";
import { BaseSecureStorage } from "./base-secure-storage";

const MCP_TOOL_CONTROL_FILE = "mcp-tool-controls.enc";
const DEFAULT_SETTINGS: MCPToolControlSettings = {
  mode: "warn",
  whitelist: [],
};

export class McpToolControlStorage extends BaseSecureStorage {
  private static instance: McpToolControlStorage;

  private constructor() {
    super();
  }

  static getInstance(): McpToolControlStorage {
    if (!McpToolControlStorage.instance) {
      McpToolControlStorage.instance = new McpToolControlStorage();
    }
    return McpToolControlStorage.instance;
  }

  private getConfigPath(): string {
    return join(this.storageDir, MCP_TOOL_CONTROL_FILE);
  }

  async getSettings(): Promise<MCPToolControlSettings> {
    const data = await this.decryptAndLoad<{ settings: MCPToolControlSettings }>(
      this.getConfigPath(),
    );
    if (!data?.settings) {
      return { ...DEFAULT_SETTINGS, whitelist: [...DEFAULT_SETTINGS.whitelist] };
    }
    return {
      mode: data.settings.mode ?? DEFAULT_SETTINGS.mode,
      whitelist: Array.isArray(data.settings.whitelist) ? data.settings.whitelist : [],
    };
  }

  async saveSettings(settings: MCPToolControlSettings): Promise<void> {
    await this.encryptAndStore(this.getConfigPath(), { settings });
  }
}

