import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HealthStatusInfo } from "../../types/index.js";
import { McpStorage } from "../storage/mcp-storage";
import { type CreateClientOptions, MCPServerClient } from "./mcp-server-client";
import type { MCPServerConfig } from "./types";

export class MCPServerManager {
  private static instance: MCPServerManager;
  private static serverConfigs: MCPServerConfig[] = [];
  private static internalServerConfigs: MCPServerConfig[] = [];
  private static internalClientTransports: Map<string, InMemoryTransport> = new Map();
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

  public async getAllMcpServerClientsAsync(): Promise<MCPServerClient[]> {
    const allConfigs = MCPServerManager.getAllServerConfigs();
    const clientPromises = allConfigs.map((config) => this.getMcpClientAsync(config.name));
    return (await Promise.all(clientPromises)).filter((client) => client !== null);
  }

  public async getSelectedMcpServerClientsAsync(
    selectedServerNames: string[],
  ): Promise<MCPServerClient[]> {
    if (!selectedServerNames.length) {
      return [];
    }

    const clientPromises = selectedServerNames.map((name) => this.getMcpClientAsync(name));
    return (await Promise.all(clientPromises)).filter((client) => client !== null);
  }

  public async collectToolsAsync(serverFilter?: string[]): Promise<Record<string, unknown>> {
    const normalizedFilter = serverFilter
      ?.map((name) => name.trim())
      .filter((name) => name.length > 0);

    const clients = normalizedFilter?.length
      ? await this.getSelectedMcpServerClientsAsync(normalizedFilter)
      : await this.getAllMcpServerClientsAsync();

    if (!clients.length) {
      throw new Error("[MCPServerManager]: No MCP clients available");
    }

    const toolSets = await Promise.all(clients.map((client) => client.listToolsAsync()));
    const toolMaps = toolSets.map((toolSet) => MCPServerManager.normalizeTools(toolSet));
    return Object.assign({}, ...toolMaps);
  }

  // Get or Create MCP client for a given server name
  public async getMcpClientAsync(name: string): Promise<MCPServerClient | null> {
    const existingClient = MCPServerManager.mcpClients.get(name);
    if (existingClient) {
      return existingClient;
    }

    const config = MCPServerManager.getAllServerConfigs().find((s) => s.name === name);
    if (!config) {
      throw new Error(`MCP server with name '${name}' not found`);
    }

    let options: CreateClientOptions | undefined;
    if (config.transport === "inMemory" && "inMemoryServerId" in config) {
      const transport = MCPServerManager.internalClientTransports.get(config.inMemoryServerId);
      if (!transport) {
        throw new Error(
          `No in-memory transport registered for server '${name}'. Ensure it was initialized correctly.`,
        );
      }
      options = { inMemoryClientTransport: transport };
    }

    const client = await MCPServerClient.createClientAsync(config, options);
    const health = await client.healthCheckAsync();
    if (health.healthy) {
      MCPServerManager.mcpClients.set(name, client);
      return client;
    }
    return null;
  }

  public static registerInternalServer(
    config: MCPServerConfig,
    clientTransport: InMemoryTransport,
  ): void {
    if (config.transport !== "inMemory" || !config.inMemoryServerId) {
      throw new Error(
        `Internal MCP server '${config.name}' must use inMemory transport with a server ID`,
      );
    }

    config.builtin = true;
    // Replace any existing entry with same name to keep latest config
    MCPServerManager.internalServerConfigs = MCPServerManager.internalServerConfigs.filter(
      (s) => s.name !== config.name,
    );
    MCPServerManager.internalServerConfigs.push(config);

    MCPServerManager.internalClientTransports.set(config.inMemoryServerId, clientTransport);
  }

  // Merge internal (built-in) and external (stored) configs, de-duplicated by name.
  // Built-ins are always processed first, so they take precedence over external configs with the same name.
  private static getAllServerConfigs(): MCPServerConfig[] {
    const internalServers = MCPServerManager.internalServerConfigs;
    const seen = new Set<string>();
    const result: MCPServerConfig[] = [];
    for (const s of internalServers) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        result.push(s);
      }
    }
    for (const s of MCPServerManager.serverConfigs) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        result.push(s);
      }
    }
    return result;
  }

  async addServerAsync(config: MCPServerConfig): Promise<void> {
    MCPServerManager.validateServerConfig(config);
    if (MCPServerManager.serverConfigs.some((s) => s.name === config.name)) {
      throw new Error(`Server with name '${config.name}' already exists`);
    }
    MCPServerManager.serverConfigs.push(config);
    await this.saveConfigAsync();
  }

  async updateServerAsync(name: string, config: MCPServerConfig): Promise<void> {
    MCPServerManager.validateServerConfig(config);
    const index = MCPServerManager.serverConfigs.findIndex((s) => s.name === name);
    if (index === -1) throw new Error(`Server '${name}' not found`);
    const existing = MCPServerManager.serverConfigs[index];
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
    return MCPServerManager.getAllServerConfigs();
  }

  public async checkServerHealthAsync(name: string): Promise<HealthStatusInfo> {
    const serverConfig = MCPServerManager.getAllServerConfigs().find((s) => s.name === name);
    if (!serverConfig) {
      throw new Error(
        `[MCPServerManager]: CheckServerHealth - MCP server with name '${name}' not found`,
      );
    }

    const client = await this.getMcpClientAsync(name);
    if (!client) {
      return {
        isHealthy: false,
        error: `MCP server client for '${name}' not found`,
      };
    }

    const healthResult = await client.healthCheckAsync();

    return {
      isHealthy: healthResult.healthy,
      successMessage:
        healthResult.toolCount > 0
          ? `Healthy - ${healthResult.toolCount} tools available`
          : "Healthy",
    };
  }

  private static validateServerConfig(config: MCPServerConfig): void {
    if (!config.name?.trim()) {
      throw new Error("Server name cannot be empty");
    }

    if (config.transport !== "inMemory" && MCPServerManager.isBuiltinName(config.name.trim())) {
      throw new Error(`Server name '${config.name}' is reserved for built-in servers`);
    }

    if (!/^[a-zA-Z0-9 _-]+$/.test(config.name.trim())) {
      throw new Error(
        `Server name '${config.name}' contains invalid characters. Only letters, numbers, spaces, underscores, and hyphens are allowed.`,
      );
    }

    if (config.transport === "streamableHttp") {
      if (!config.url?.trim()) {
        throw new Error("HTTP transport servers require a URL");
      }

      try {
        new URL(config.url);
      } catch (_error) {
        throw new Error(`Invalid URL '${config.url}' for server '${config.name}'`);
      }
      return;
    }

    if (config.transport === "stdio") {
      if (!config.command?.trim()) {
        throw new Error("Stdio transport servers require a command");
      }

      if (config.args && !config.args.every((value) => typeof value === "string")) {
        throw new Error("Stdio server arguments must be a string array");
      }

      if (config.env && Object.values(config.env).some((value) => typeof value !== "string")) {
        throw new Error("Stdio server environment variables must map to string values");
      }
    }
  }

  public static normalizeTools(toolSet: unknown): Record<string, unknown> {
    if (!toolSet) {
      return {};
    }

    if (Array.isArray(toolSet)) {
      return toolSet.reduce<Record<string, unknown>>((accumulator, entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          "name" in entry &&
          typeof (entry as { name: unknown }).name === "string"
        ) {
          accumulator[(entry as { name: string }).name] = entry;
        }
        return accumulator;
      }, {});
    }

    if (typeof toolSet === "object") {
      return { ...(toolSet as Record<string, unknown>) };
    }

    return {};
  }

  private static isBuiltinName(name: string): boolean {
    return MCPServerManager.internalServerConfigs.some((s) => s.name === name);
  }
}
