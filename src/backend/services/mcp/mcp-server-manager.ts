import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolSet } from "ai";
import { randomUUID } from "node:crypto";
import type { HealthStatusInfo } from "../../types/index.js";
import { McpStorage } from "../storage/mcp-storage";
import { type CreateClientOptions, MCPServerClient } from "./mcp-server-client";
import type { MCPServerConfig } from "./types";

export class MCPServerManager {
  private static instance: MCPServerManager;
  private static internalServerConfigs: MCPServerConfig[] = [];
  private static internalClientTransports: Map<string, InMemoryTransport> = new Map();
  private static mcpClients: Map<string, MCPServerClient> = new Map();
  private static mcpClientPromises: Map<string, Promise<MCPServerClient | null>> = new Map();
  private constructor() { }

  public static async getInstanceAsync(): Promise<MCPServerManager> {
    if (MCPServerManager.instance) {
      return MCPServerManager.instance;
    }

    MCPServerManager.instance = new MCPServerManager();
    return MCPServerManager.instance;
  }

  public async getAllMcpServerClientsAsync(): Promise<MCPServerClient[]> {
    const allConfigs = await MCPServerManager.getAllServerConfigsAsync();
    const enabledConfigs = allConfigs.filter((c) => c.enabled !== false);
    const results = await Promise.allSettled(
      enabledConfigs.map((config) => this.getMcpClientAsync(config.id)),
    );
    return results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => (r as PromiseFulfilledResult<MCPServerClient | null>).value as MCPServerClient);
  }

  public async getSelectedMcpServerClientsAsync(
    selectedServerIdsOrNames: string[],
  ): Promise<MCPServerClient[]> {
    if (!selectedServerIdsOrNames.length) {
      return [];
    }

    const results = await Promise.allSettled(
      selectedServerIdsOrNames.map((identifier) => this.getMcpClientAsync(identifier)),
    );
    return results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => (r as PromiseFulfilledResult<MCPServerClient | null>).value as MCPServerClient);
  }

  public async collectToolsWithServerPrefixAsync(): Promise<ToolSet> {
    const clients = await this.getAllMcpServerClientsAsync();

    if (!clients.length) {
      throw new Error("[MCPServerManager]: No MCP clients available");
    }

    const results = await Promise.allSettled(
      clients.map((client) => client.listToolsWithServerPrefixAsync()),
    );
    const toolMaps = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => MCPServerManager.normalizeTools((r as PromiseFulfilledResult<unknown>).value));

    const combined = Object.assign({}, ...toolMaps) as ToolSet;

    if (Object.keys(combined).length === 0) {
      throw new Error("[MCPServerManager]: No tools available from selected/healthy servers");
    }
    return combined;
  }

  // Get or Create MCP client for a given server name
  public async getMcpClientAsync(serverId: string): Promise<MCPServerClient | null> {
    const config = await MCPServerManager.resolveServerConfigAsync(serverId);
    if (!config) {
      throw new Error(`MCP server '${serverId}' not found`);
    }

    const cacheKey = config.id;

    const existingClient = MCPServerManager.mcpClients.get(cacheKey);
    if (existingClient) {
      return existingClient;
    }

    const inFlight = MCPServerManager.mcpClientPromises.get(cacheKey);
    if (inFlight) {
      return await inFlight;
    }

    let options: CreateClientOptions | undefined;
    if (config.transport === "inMemory" && "inMemoryServerId" in config) {
      const transport = MCPServerManager.internalClientTransports.get(config.inMemoryServerId);
      if (!transport) {
        throw new Error(
          `No in-memory transport registered for server '${config.name}'. Ensure it was initialized correctly.`,
        );
      }
      options = { inMemoryClientTransport: transport };
    }

    const creationPromise = (async () => {
      try {
        const client = await MCPServerClient.createClientAsync(config, options);
        const health = await client.healthCheckAsync();
        if (health.healthy) {
          MCPServerManager.mcpClients.set(cacheKey, client);
          return client;
        }
        return null;
      } catch (err) {
        console.warn(
          `[MCPServerManager] Failed to initialize client '${config.name}' (${config.id}): ${String(err)}`,
        );
        return null;
      } finally {
        MCPServerManager.mcpClientPromises.delete(cacheKey);
      }
    })();

    MCPServerManager.mcpClientPromises.set(cacheKey, creationPromise);
    return await creationPromise;
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
    config.enabled = true;

    // Replace any existing entry with same name to keep latest config
    if (!config.id?.trim()) {
      throw new Error(`Internal MCP server '${config.name}' must have a stable id`);
    }

    // Replace any existing entry with same id to keep latest config
    MCPServerManager.internalServerConfigs = MCPServerManager.internalServerConfigs.filter(
      (s) => s.id !== config.id,
    );
    MCPServerManager.internalServerConfigs.push(config);

    MCPServerManager.internalClientTransports.set(config.inMemoryServerId, clientTransport);
  }

  private static async getStoredServerConfigsAsync(): Promise<MCPServerConfig[]> {
    return await McpStorage.getInstance().getMcpServerConfigsAsync();
  }

  private static mergeWithInternalServers(externalServers: MCPServerConfig[]): MCPServerConfig[] {
    const internalServers = MCPServerManager.internalServerConfigs;
    const seen = new Set<string>();
    const result: MCPServerConfig[] = [];
    for (const s of internalServers) {
      if (!seen.has(s.id)) {
        s.enabled = true; // built-in servers are always enabled
        seen.add(s.id);
        result.push(s);
      }
    }
    for (const s of externalServers) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        result.push(s);
      }
    }
    return result;
  }

  // Merge internal (built-in) and external (stored) configs, de-duplicated by id.
  // Built-ins are always processed first, so they take precedence over external configs with the same name.
  private static async getAllServerConfigsAsync(): Promise<MCPServerConfig[]> {
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    return MCPServerManager.mergeWithInternalServers(storedConfigs);
  }

  private static async getServerConfigByIdAsync(id: string): Promise<MCPServerConfig | undefined> {
    const configs = await MCPServerManager.getAllServerConfigsAsync();
    return configs.find((s) => s.id === id);
  }

  private static async getServerConfigByNameAsync(
    name: string,
  ): Promise<MCPServerConfig | undefined> {
    const configs = await MCPServerManager.getAllServerConfigsAsync();
    return configs.find((s) => s.name === name);
  }

  private static async resolveServerConfigAsync(
    idOrName: string,
  ): Promise<MCPServerConfig | undefined> {
    return (
      (await MCPServerManager.getServerConfigByIdAsync(idOrName)) ??
      (await MCPServerManager.getServerConfigByNameAsync(idOrName))
    );
  }

  async addServerAsync(config: MCPServerConfig): Promise<void> {
    const server: MCPServerConfig = {
      ...(config as unknown as Record<string, unknown>),
      id: config.id?.trim() ? config.id : randomUUID(),
    } as MCPServerConfig;

    MCPServerManager.validateServerConfig(server);
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    if (storedConfigs.some((s) => s.id === server.id)) {
      throw new Error(`Server with id '${server.id}' already exists`);
    }


    storedConfigs.push(server);
    await this.saveConfigAsync(storedConfigs);
  }

  async updateServerAsync(serverId: string, config: MCPServerConfig): Promise<void> {
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    let index = storedConfigs.findIndex((s) => s.id === serverId || s.name === serverId);

    if (index === -1) {
      storedConfigs.push(config);
      index = storedConfigs.findIndex((s) => s.id === serverId || s.name === serverId);
    }

    const existing = storedConfigs[index];

    const merged: MCPServerConfig = {
      ...existing,
      ...(config as unknown as Record<string, unknown>),
      id: existing.id,
    } as MCPServerConfig;

    MCPServerManager.validateServerConfig(merged);

    // If the name is changing, ensure the new name isn't already used
    if (merged.name !== existing.name && storedConfigs.some((s) => s.name === merged.name)) {
      throw new Error(`Server with name '${merged.name}' already exists`);
    }

    // If the name changed OR the config has changed (URL/headers/etc), recreate client
    const configChanged = JSON.stringify(existing) !== JSON.stringify(merged);
    if (configChanged) {
      await MCPServerManager.mcpClients.get(existing.id)?.disconnectAsync();
      MCPServerManager.mcpClients.delete(existing.id);
    }

    storedConfigs[index] = merged;
    await this.saveConfigAsync(storedConfigs);
  }

  async removeServerAsync(serverId: string): Promise<void> {
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    const index = storedConfigs.findIndex((s) => s.id === serverId);
    if (index === -1) throw new Error(`Server '${serverId}' not found`);
    const existing = storedConfigs[index];
    storedConfigs.splice(index, 1);

    await MCPServerManager.mcpClients.get(existing.id)?.disconnectAsync();
    MCPServerManager.mcpClients.delete(existing.id);
    await this.saveConfigAsync(storedConfigs);
  }

  private async saveConfigAsync(configs: MCPServerConfig[]): Promise<void> {
    try {
      await McpStorage.getInstance().storeMcpServers(configs);
    } catch (err) {
      console.error("[MCPOrchestrator] Failed to save config to secure storage:", err);
      throw err;
    }
  }

  public async listAvailableServers(): Promise<MCPServerConfig[]> {
    return await MCPServerManager.getAllServerConfigsAsync();
  }

  public async checkServerHealthAsync(name: string): Promise<HealthStatusInfo> {
    const serverConfig = await MCPServerManager.resolveServerConfigAsync(name);
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
        isChecking: false,
      };
    }

    const healthResult = await client.healthCheckAsync();

    return {
      isHealthy: healthResult.healthy,
      isChecking: false,
      successMessage:
        healthResult.toolCount > 0
          ? `Healthy - ${healthResult.toolCount} tools available`
          : "Healthy",
    };
  }

  private static validateServerConfig(config: MCPServerConfig): void {
    if (!config.id?.trim()) {
      throw new Error("Server id cannot be empty");
    }

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

  public async getWhitelistWithServerPrefixAsync(): Promise<string[]> {
    const storage = McpStorage.getInstance();
    const serverConfigs = await storage.getMcpServerConfigsAsync();

    return serverConfigs.flatMap((config) => {
      const sanitizedServerName = config.name.replace(/\s+/g, "_");
      return (config.toolWhitelist ?? []).map((toolName) => `${sanitizedServerName}__${toolName}`);
    });
  }

  public async addToolToServerWhitelistAsync(serverId: string, toolName: string): Promise<void> {
    const storage = McpStorage.getInstance();
    let serverConfigs = await storage.getMcpServerConfigsAsync();
    const targetIndex = serverConfigs.findIndex((server) => server.id === serverId);

    if (targetIndex === -1) {
      const internalConfig = MCPServerManager.internalServerConfigs.find(
        (s) => s.id === serverId,
      );

      if (!internalConfig) {
        throw new Error(`[McpStorage]: MCP server with name ${serverId} not found`);
      }

      const newConfig = {
        ...internalConfig,
        toolWhitelist: [toolName],
      };

      serverConfigs = [...serverConfigs, newConfig];
      await storage.storeMcpServers(serverConfigs);
      return;
    }

    const existingWhitelist = new Set(serverConfigs[targetIndex].toolWhitelist ?? []);
    if (existingWhitelist.has(toolName)) {
      return;
    }

    serverConfigs[targetIndex] = {
      ...serverConfigs[targetIndex],
      toolWhitelist: [...existingWhitelist, toolName],
    };

    await storage.storeMcpServers(serverConfigs);
  }
}
