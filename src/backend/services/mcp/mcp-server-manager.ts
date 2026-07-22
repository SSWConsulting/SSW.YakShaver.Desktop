import { randomUUID } from "node:crypto";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolSet } from "ai";
import { PRESET_MCP_SERVERS } from "../../../shared/mcp/preset-servers";
import type { HealthStatusInfo } from "../../types/index.js";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";
import { McpStorage } from "../storage/mcp-storage";
import { authorizeWithBackend } from "./mcp-oauth";
import { type CreateClientOptions, MCPServerClient } from "./mcp-server-client";
import { expandHomePath } from "./mcp-utils";
import type { MCPServerConfig } from "./types";

/** Fields valid ONLY on an HTTP (streamableHttp) server config. */
const HTTP_ONLY_FIELDS = ["url", "headers", "version", "timeoutMs"] as const;
/** Fields valid ONLY on a stdio server config. */
const STDIO_ONLY_FIELDS = ["command", "args", "env", "cwd", "stderr"] as const;

function hasDuplicateServerName(
  configs: readonly MCPServerConfig[],
  name: string,
  excludedId?: string,
): boolean {
  const normalizedName = name.trim().toLowerCase();
  return configs.some(
    (config) => config.id !== excludedId && config.name.trim().toLowerCase() === normalizedName,
  );
}

export class MCPServerManager {
  private static instance: MCPServerManager;
  private static internalServerConfigs: MCPServerConfig[] = [];
  private static internalClientTransports: Map<string, InMemoryTransport> = new Map();
  private static mcpClients: Map<string, MCPServerClient> = new Map();
  private static mcpClientPromises: Map<string, Promise<MCPServerClient | null>> = new Map();
  // In-flight raw client creations, keyed by server id. Shared so concurrent
  // callers (e.g. overlapping health checks) reuse ONE creation instead of each
  // building a client and racing to overwrite the cache, leaking the loser (#982).
  private static clientCreationPromises: Map<string, Promise<MCPServerClient>> = new Map();
  private constructor() {}

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

    // Get all configs to filter by enabled status
    const allConfigs = await MCPServerManager.getAllServerConfigsAsync();
    const enabledSelectedIds = selectedServerIdsOrNames.filter((identifier) => {
      const config = allConfigs.find((c) => c.id === identifier || c.name === identifier);
      return config && config.enabled !== false;
    });

    if (!enabledSelectedIds.length) {
      console.warn(
        "[MCPServerManager]: No matching enabled MCP servers found for selected identifiers:",
        selectedServerIdsOrNames,
      );
      return [];
    }

    const results = await Promise.allSettled(
      enabledSelectedIds.map((identifier) => this.getMcpClientAsync(identifier)),
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

  /**
   * Collect tools from selected servers only.
   * Returns tools from selected servers, or all enabled servers if no filter provided (backward compatibility).
   * Disabled servers are excluded in all cases.
   */
  public async collectToolsForSelectedServersAsync(serverIds?: string[]): Promise<ToolSet> {
    const clients =
      serverIds && serverIds.length > 0
        ? await this.getSelectedMcpServerClientsAsync(serverIds)
        : await this.getAllMcpServerClientsAsync();

    if (!clients.length) {
      const serverInfo = this.getServerInfo(serverIds);
      throw new Error(`[MCPServerManager]: No MCP clients available.${serverInfo}`);
    }

    const results = await Promise.allSettled(
      clients.map((client) => client.listToolsWithServerPrefixAsync()),
    );
    const fulfilledResults = results.filter(
      (r): r is PromiseFulfilledResult<ToolSet> => r.status === "fulfilled",
    );
    const rejectedCount = results.filter((r) => r.status === "rejected").length;
    const toolMaps = fulfilledResults.map((r) => MCPServerManager.normalizeTools(r.value));
    const combined = Object.assign({}, ...toolMaps) as ToolSet;

    if (Object.keys(combined).length === 0) {
      const serverInfo = this.getServerInfo(serverIds);
      throw new Error(
        `[MCPServerManager]: No tools available. Servers: ${clients.length}, successful: ${fulfilledResults.length}, failed: ${rejectedCount}.${serverInfo}`,
      );
    }
    return combined;
  }

  private getServerInfo(serverIds?: string[]): string {
    return serverIds && serverIds.length > 0
      ? ` Selected: ${serverIds.join(", ")}.`
      : " Using all enabled servers.";
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
    if (config.transport === "inMemory" && config.inMemoryServerId) {
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
      if (s.builtin) continue;
      if (!seen.has(s.id)) {
        seen.add(s.id);
        result.push(s);
      }
    }
    // Add preset servers not yet stored by the user (they appear with enabled: false)
    for (const preset of PRESET_MCP_SERVERS) {
      if (preset.id && !seen.has(preset.id)) {
        seen.add(preset.id);
        result.push({ ...preset });
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

  public static async getServerConfigByIdAsync(id: string): Promise<MCPServerConfig | undefined> {
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
    serverId: string,
  ): Promise<MCPServerConfig | undefined> {
    return (
      (await MCPServerManager.getServerConfigByIdAsync(serverId)) ??
      (await MCPServerManager.getServerConfigByNameAsync(serverId))
    );
  }

  async addServerAsync(config: MCPServerConfig): Promise<MCPServerConfig> {
    const server: MCPServerConfig = {
      ...(config as unknown as Record<string, unknown>),
      id: config.id?.trim() ? config.id : randomUUID(),
    } as MCPServerConfig;

    MCPServerManager.validateServerConfig(server);
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    const allConfigs = MCPServerManager.mergeWithInternalServers(storedConfigs);
    if (hasDuplicateServerName(allConfigs, server.name, server.id)) {
      throw new Error(`Server with name '${server.name}' already exists`);
    }
    if (storedConfigs.some((s) => s.id === server.id)) {
      throw new Error(`Server with id '${server.id}' already exists`);
    }

    storedConfigs.push(server);
    await this.saveConfigAsync(storedConfigs);
    return server;
  }

  async updateServerAsync(serverId: string, config: MCPServerConfig): Promise<void> {
    const storedConfigs = await MCPServerManager.getStoredServerConfigsAsync();
    let index = storedConfigs.findIndex((s) => s.id === serverId);

    if (index === -1) {
      storedConfigs.push(config);
      index = storedConfigs.findIndex((s) => s.id === serverId);
    }

    const existing = storedConfigs[index];

    const mergedRecord: Record<string, unknown> = {
      ...(existing as unknown as Record<string, unknown>),
      ...(config as unknown as Record<string, unknown>),
      id: existing.id,
    };

    // On a transport change, strip ONLY the old transport's transport-specific
    // fields (e.g. a stale url + secret-bearing headers on a now-stdio server).
    // Common fields like `enabled`/`toolWhitelist` are preserved from `existing`
    // even when the incoming config omits them.
    if (existing.transport !== config.transport) {
      const staleFields = config.transport === "stdio" ? HTTP_ONLY_FIELDS : STDIO_ONLY_FIELDS;
      for (const field of staleFields) {
        delete mergedRecord[field];
      }
    }

    const merged = mergedRecord as unknown as MCPServerConfig;

    MCPServerManager.validateServerConfig(merged);
    const allConfigs = MCPServerManager.mergeWithInternalServers(storedConfigs);
    if (hasDuplicateServerName(allConfigs, merged.name, existing.id)) {
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
    if (index === -1) return; // Server was never persisted (e.g. an unconnected preset) — nothing to remove
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

  /**
   * Returns a cached client for the config, or creates one — deduplicating
   * concurrent creations so overlapping callers share a single client and the
   * cache is never overwritten by a racing build (which would leak the loser's
   * connection / stdio process). The created client is cached before returning,
   * so it is always cache-owned and never orphaned. Rejects if creation fails
   * (callers classify the error); unlike getMcpClientAsync this does not run a
   * health check or swallow the error (#982).
   */
  private static async getOrCreateClientAsync(config: MCPServerConfig): Promise<MCPServerClient> {
    const cacheKey = config.id;

    const cached = MCPServerManager.mcpClients.get(cacheKey);
    if (cached) {
      return cached;
    }

    const inFlight = MCPServerManager.clientCreationPromises.get(cacheKey);
    if (inFlight) {
      return await inFlight;
    }

    const creation = (async () => {
      const client = await MCPServerClient.createClientAsync(config);
      MCPServerManager.mcpClients.set(cacheKey, client);
      return client;
    })();

    MCPServerManager.clientCreationPromises.set(cacheKey, creation);
    try {
      return await creation;
    } finally {
      MCPServerManager.clientCreationPromises.delete(cacheKey);
    }
  }

  public async checkServerHealthAsync(serverId: string): Promise<HealthStatusInfo> {
    const serverConfig = await MCPServerManager.resolveServerConfigAsync(serverId);
    if (!serverConfig) {
      throw new Error(
        `[MCPServerManager]: CheckServerHealth - MCP server with id '${serverId}' not found`,
      );
    }

    // inMemory/builtin servers never hit the auth path; keep them on the
    // existing null-returning cache path so they stay green.
    if (serverConfig.transport === "inMemory") {
      const client = await this.getMcpClientAsync(serverId);
      if (!client) {
        return {
          isHealthy: false,
          error: `MCP server client for '${serverId}' not found`,
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

    // Reuse the cached client when one already exists: probing it avoids
    // spawning a fresh connection (a new stdio child process, in that transport's
    // case) on every recurring health check, and — critically — never disconnects
    // a client the orchestrator may currently be running tools through (#982).
    let client: MCPServerClient;
    try {
      // Deduplicate concurrent creation: two overlapping health checks must not
      // both build a client and race to overwrite the cache, leaking the loser's
      // connection / stdio process. getOrCreateClientAsync returns the cached
      // client if present, else shares ONE in-flight creation via
      // mcpClientPromises and caches the result before returning (#982).
      client = await MCPServerManager.getOrCreateClientAsync(serverConfig);
    } catch (err) {
      return {
        isHealthy: false,
        error: String(err),
        isChecking: false,
        authFailed: MCPServerClient.isAuthError(err),
      };
    }

    // The client is now always cache-owned, so a probe failure just decides
    // whether it should stay. Success: leave it. Non-auth failure: the
    // connection / stdio process is likely dead — evict + close so the next
    // getMcpClientAsync rebuilds a fresh one. Auth (401) failure: leave it in
    // place; reauthorizeServerAsync owns that eviction and the connection object
    // is still usable once re-credentialed (#982).
    const probe = await client.probeHealthAsync();
    if (!probe.healthy && !probe.authFailed) {
      // Only evict if the cache still holds THIS client — a concurrent reauth or
      // health check may have already swapped it out, and we must not close the
      // replacement or drop a newer entry.
      if (MCPServerManager.mcpClients.get(serverConfig.id) === client) {
        MCPServerManager.mcpClients.delete(serverConfig.id);
      }
      await client.disconnectAsync().catch(() => undefined);
    }
    return {
      isHealthy: probe.healthy,
      isChecking: false,
      authFailed: probe.authFailed,
      error: probe.healthy ? undefined : probe.error,
      successMessage: probe.healthy
        ? probe.toolCount > 0
          ? `Healthy - ${probe.toolCount} tools available`
          : "Healthy"
        : undefined,
    };
  }

  /**
   * Re-authorizes an OAuth MCP server in place (#982): drop the dead credential,
   * invalidate any cached client, and rerun the existing backend OAuth flow.
   * Never mutates `enabled` — this is a credential refresh, not a disconnect.
   */
  public async reauthorizeServerAsync(serverId: string): Promise<void> {
    const config = await MCPServerManager.resolveServerConfigAsync(serverId);
    if (!config) {
      throw new Error(`[MCPServerManager]: Reauthorize - MCP server '${serverId}' not found`);
    }
    if (config.transport !== "streamableHttp" || config.builtin || !config.url) {
      throw new Error(`[MCPServerManager]: Reauthorize - server '${serverId}' does not use OAuth`);
    }
    const tokenStorage = McpOAuthTokenStorage.getInstance();
    await tokenStorage.clearTokensAsync(serverId);
    await MCPServerManager.mcpClients
      .get(config.id)
      ?.disconnectAsync()
      .catch(() => undefined);
    MCPServerManager.mcpClients.delete(config.id);
    await authorizeWithBackend(tokenStorage, expandHomePath(config.url), serverId);
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

    const whitelist = serverConfigs.flatMap((config) => {
      const sanitizedServerName = config.name.replace(/\s+/g, "_");
      return (config.toolWhitelist ?? []).map((toolName) => `${sanitizedServerName}__${toolName}`);
    });

    // Built-in server tools are always whitelisted regardless of Approval Mode.
    // Uses cached tool names to avoid repeated RPC calls during the orchestrator loop.
    for (const client of MCPServerManager.mcpClients.values()) {
      if (client.builtin) {
        const toolNames = await client.getPrefixedToolNamesAsync();
        whitelist.push(...toolNames);
      }
    }

    return whitelist;
  }

  public async addToolToServerWhitelistAsync(serverName: string, toolName: string): Promise<void> {
    const storage = McpStorage.getInstance();
    let serverConfigs = await storage.getMcpServerConfigsAsync();
    const targetIndex = serverConfigs.findIndex((server) => server.name === serverName);

    if (targetIndex === -1) {
      const internalConfig = MCPServerManager.internalServerConfigs.find(
        (s) => s.name === serverName,
      );

      if (!internalConfig) {
        throw new Error(`[McpStorage]: MCP server with name ${serverName} not found`);
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
