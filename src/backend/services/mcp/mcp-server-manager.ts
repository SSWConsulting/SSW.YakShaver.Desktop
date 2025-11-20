import type { HealthStatusInfo } from "../../types/index.js";
import { formatErrorMessage } from "../../utils/error-utils";
import { McpStorage } from "../storage/mcp-storage";
import { InternalMcpTransportRegistry } from "./internal/mcp-transport-registry";
import { MCPServerClient } from "./mcp-server-client";
import type { MCPServerConfig } from "./types";

export class MCPServerManager {
  private static instance: MCPServerManager;
  private static serverConfigs: MCPServerConfig[];
  private static mcpClients: Map<string, MCPServerClient> = new Map();
  private constructor() {}

  public static async getInstanceAsync(): Promise<MCPServerManager> {
    if (MCPServerManager.instance) {
      return MCPServerManager.instance;
    }

    MCPServerManager.instance = new MCPServerManager();
    MCPServerManager.serverConfigs = await McpStorage.getInstance().getMcpServerConfigsAsync();
    return MCPServerManager.instance;
  }

  public async getAllMcpServerClientsAsync(): Promise<MCPServerClient[] | null> {
    const clientPromises = MCPServerManager.serverConfigs.map((config) =>
      this.getMcpClientAsync(config.name),
    );
    return await Promise.all(clientPromises);
  }

  public async getSelectedMcpServerClientsAsync(
    selectedServerNames: string[],
  ): Promise<MCPServerClient[]> {
    const clientPromises = selectedServerNames.map((name) => this.getMcpClientAsync(name));
    return await Promise.all(clientPromises);
  }

  // Get or Create MCP client for a given server name
  public async getMcpClientAsync(name: string): Promise<MCPServerClient> {
    const internalServers = InternalMcpTransportRegistry.listServerConfigs();
    const config =
      internalServers.find((s) => s.name === name) ||
      MCPServerManager.serverConfigs.find((s) => s.name === name);
    if (!config) {
      throw new Error(`MCP server with name '${name}' not found`);
    }

    let client = MCPServerManager.mcpClients.get(name);
    if (client) {
      return client;
    }

    client = await MCPServerClient.createClientAsync(config);
    MCPServerManager.mcpClients.set(name, client);
    return client;
  }

  async addServerAsync(config: MCPServerConfig): Promise<void> {
    MCPServerManager.validateServerName(config.name);
    if (config.builtin) {
      throw new Error("Cannot add a built-in server");
    }
    if (MCPServerManager.serverConfigs.some((s) => s.name === config.name)) {
      throw new Error(`Server with name '${config.name}' already exists`);
    }
    MCPServerManager.serverConfigs.push(config);
    await this.saveConfigAsync();
  }

  async updateServerAsync(name: string, config: MCPServerConfig): Promise<void> {
    MCPServerManager.validateServerName(config.name);
    const index = MCPServerManager.serverConfigs.findIndex((s) => s.name === name);
    if (index === -1) throw new Error(`Server '${name}' not found`);
    const existing = MCPServerManager.serverConfigs[index];
    if (existing.builtin) {
      throw new Error("Cannot update a built-in server");
    }
    // If the name is changing, ensure the new name isn't already used
    if (
      config.name !== name &&
      MCPServerManager.serverConfigs.some((s) => s.name === config.name)
    ) {
      throw new Error(`Server with name '${config.name}' already exists`);
    }

    // If the name changed OR the config has changed (URL/headers/etc), recreate client
    const configChanged = JSON.stringify(existing) !== JSON.stringify(config);
    if (configChanged) {
      await MCPServerManager.mcpClients.get(name)?.disconnectAsync();
      MCPServerManager.mcpClients.delete(name);
    }

    MCPServerManager.serverConfigs[index] = config;
    await this.saveConfigAsync();
  }

  async removeServerAsync(name: string): Promise<void> {
    const index = MCPServerManager.serverConfigs.findIndex((s) => s.name === name);
    if (index === -1) throw new Error(`Server '${name}' not found`);
    const existing = MCPServerManager.serverConfigs[index];
    if (existing.builtin) {
      throw new Error("Cannot remove a built-in server");
    }
    MCPServerManager.serverConfigs.splice(index, 1);
    await MCPServerManager.mcpClients.get(name)?.disconnectAsync();
    MCPServerManager.mcpClients.delete(name);
    await this.saveConfigAsync();
  }

  private async saveConfigAsync(): Promise<void> {
    try {
      await McpStorage.getInstance().storeMcpServers(MCPServerManager.serverConfigs);
    } catch (err) {
      console.error("[MCPOrchestrator] Failed to save config to secure storage:", err);
      throw err;
    }
  }

  public listAvailableServers(): MCPServerConfig[] {
    const internalServers = InternalMcpTransportRegistry.listServerConfigs();
    return [...internalServers, ...MCPServerManager.serverConfigs];
  }

  public async checkServerHealthAsync(name: string): Promise<HealthStatusInfo> {
    try {
      const internalServers = InternalMcpTransportRegistry.listServerConfigs();
      const serverConfig =
        internalServers.find((s) => s.name === name) ||
        MCPServerManager.serverConfigs.find((s) => s.name === name);
      if (!serverConfig) {
        throw new Error(
          `[MCPServerManager]: CheckServerHealth - MCP server with name '${name}' not found`,
        );
      }

      const client = await this.getMcpClientAsync(name);
      const toolList = await client.listTools();
      const length = Object.keys(toolList).length;
      return {
        isHealthy: true,
        successMessage: length > 0 ? `Healthy - ${length} tools available` : "Healthy",
      };
    } catch (err) {
      console.error(`[MCPServerManager]: Health check failed for MCP server '${name}':`, err);
      return {
        isHealthy: false,
        error: formatErrorMessage(err),
      };
    }
  }

  private static validateServerName(name: string): void {
    if (!name?.trim()) throw new Error("Server name cannot be empty");
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      throw new Error(
        `Server name '${name}' contains invalid characters. Only letters, numbers, spaces, underscores, and hyphens are allowed.`,
      );
    }
  }
}
