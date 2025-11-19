import { McpStorage } from "../storage/mcp-storage";
import { MCPServerClient } from "./mcp-server-client";
import { MCPServerConfig } from "./types";
import type { HealthStatusInfo } from "../../types/index.js";


export class MCPServerManager {
    private static instance: MCPServerManager;
    private static serverConfigs: MCPServerConfig[] = [];
    private static mcpClients: Map<string, MCPServerClient> = new Map();
    private constructor() { }

    public static async getInstanceAsync(): Promise<MCPServerManager> {
        if (MCPServerManager.instance) {
            return MCPServerManager.instance;
        }

        MCPServerManager.instance = new MCPServerManager();
        MCPServerManager.serverConfigs = await McpStorage.getInstance().getMcpServerConfigsAsync();
        return MCPServerManager.instance;
    }

    public async getAllMcpServerClientsAsync(): Promise<MCPServerClient[]> {

        if (!MCPServerManager.serverConfigs.length) {
            return [];
        }

        const clientPromises = MCPServerManager.serverConfigs.map((config) =>
            this.getMcpClientAsync(config.name),
        );
        return (await Promise.all(clientPromises)).filter((client) => client !== null);
    }

    public async getSelectedMcpServerClientsAsync(selectedServerNames: string[]): Promise<MCPServerClient[]> {
        if (!selectedServerNames.length) {
            return [];
        }

        const clientPromises = selectedServerNames.map((name) =>
            this.getMcpClientAsync(name),
        );
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
        const config = MCPServerManager.serverConfigs.find((s) => s.name === name);
        if (!config) {
            throw new Error(`MCP server with name '${name}' not found`);
        }

        if (MCPServerManager.mcpClients.has(name)) {
            return MCPServerManager.mcpClients.get(name)!;
        }

        const client = await MCPServerClient.createClientAsync(config);
        const health = await client.healthCheckAsync();
        if (health.healthy) {
            MCPServerManager.mcpClients.set(name, client);
            return client;
        }

        return null;
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
        if (config.name !== name && MCPServerManager.serverConfigs.some((s) => s.name === config.name)) {
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
        return [...MCPServerManager.serverConfigs];
    }

    public async checkServerHealthAsync(name: string): Promise<HealthStatusInfo> {

        const serverConfig = MCPServerManager.serverConfigs.find((s) => s.name === name);
        if (!serverConfig) {
            throw new Error(`[MCPServerManager]: CheckServerHealth - MCP server with name '${name}' not found`);
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
            successMessage: healthResult.toolCount > 0 ? `Healthy - ${healthResult.toolCount} tools available` : "Healthy",
        };

    }

    private static validateServerConfig(config: MCPServerConfig): void {
        if (config.transport === "streamableHttp") {
            if (!config.url?.trim()) {
                throw new Error("HTTP transport servers require a URL");
            }

            try {
                new URL(config.url);
            } catch (error) {
                throw new Error(`Invalid URL '${config.url}' for server '${config.name}'`);
            }
            return;
        }

        if (!config.name?.trim()) {
            throw new Error("Server name cannot be empty");
        }

        if (!/^[a-zA-Z0-9 _-]+$/.test(config.name)) {
            throw new Error(
                `Server name '${config.name}' contains invalid characters. Only letters, numbers, spaces, underscores, and hyphens are allowed.`,
            );
        }

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
}