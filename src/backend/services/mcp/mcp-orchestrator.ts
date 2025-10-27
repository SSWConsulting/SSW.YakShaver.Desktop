import { BrowserWindow } from "electron";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/index.js";
import { OpenAIService } from "../openai/openai-service.js";
import { McpStorage } from "../storage/mcp-storage.js";
import { MCPClientWrapper } from "./mcp-client-wrapper.js";
import type { MCPServerConfig } from "./types.js";

export interface MCPOrchestratorOptions {
  eagerCreate?: boolean; // create all client wrappers at construction
  eagerConnect?: boolean; // connect immediately (implies eagerCreate)
}

export interface MCPStepEvent {
  type: "start" | "tool_call" | "tool_result" | "final_result";
  message?: string;
  toolName?: string;
  serverName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: number;
}

export class MCPOrchestrator {
  private readonly servers: MCPServerConfig[] = [];
  private clients = new Map<string, MCPClientWrapper>();
  private initialized = false;
  private llmClient: OpenAIService; // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
  private mcpStorage: McpStorage;
  private opts: MCPOrchestratorOptions;

  private sendStepEvent(event: MCPStepEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("mcp:step-update", event);
      }
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

  private static sanitizeServerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  constructor(
    opts: MCPOrchestratorOptions = {},
    llmClient: OpenAIService = OpenAIService.getInstance(),
  ) {
    this.llmClient = llmClient;
    this.mcpStorage = McpStorage.getInstance();
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    await this.loadConfig();
    if (this.opts.eagerCreate || this.opts.eagerConnect) {
      this.createAllClients();
    }
    if (this.opts.eagerConnect) {
      // Fire and forget; caller can also await connectAll()
      void this.connectAll().catch((e) =>
        console.error("[MCPOrchestrator] eagerConnect failed:", e),
      );
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const servers = await this.mcpStorage.getMcpServers();
      this.servers.splice(0, this.servers.length, ...servers);
      this.initialized = true;
      console.log(
        `[MCPOrchestrator] Loaded ${this.servers.length} MCP server configuration(s) from secure storage`,
      );
    } catch (err) {
      console.error("[MCPOrchestrator] Failed to load config from secure storage:", err);
      // Initialize with empty array on error
      this.servers.splice(0, this.servers.length);
      this.initialized = true;
    }
  }
  async reloadConfig(): Promise<void> {
    await this.loadConfig();
  }

  async listAvailableServers(): Promise<MCPServerConfig[]> {
    if (!this.initialized) {
      await this.loadConfig();
    }
    return [...this.servers];
  }

  private async saveConfig(): Promise<void> {
    try {
      await this.mcpStorage.storeMcpServers(this.servers);
      console.log(`[MCPOrchestrator] Saved ${this.servers.length} server(s) to secure storage`);
    } catch (err) {
      console.error("[MCPOrchestrator] Failed to save config to secure storage:", err);
      throw err;
    }
  }
  async addServer(config: MCPServerConfig): Promise<void> {
    MCPOrchestrator.validateServerName(config.name);
    if (this.servers.some((s) => s.name === config.name)) {
      throw new Error(`Server with name '${config.name}' already exists`);
    }
    this.servers.push(config);
    await this.saveConfig();
  }

  async updateServer(name: string, config: MCPServerConfig): Promise<void> {
    MCPOrchestrator.validateServerName(config.name);
    const index = this.servers.findIndex((s) => s.name === name);
    if (index === -1) throw new Error(`Server '${name}' not found`);
    if (config.name !== name) {
      if (this.servers.some((s) => s.name === config.name)) {
        throw new Error(`Server with name '${config.name}' already exists`);
      }
      this.clients.get(name)?.disconnect();
      this.clients.delete(name);
    }
    this.servers[index] = config;
    await this.saveConfig();
  }

  async removeServer(name: string): Promise<void> {
    const index = this.servers.findIndex((s) => s.name === name);
    if (index === -1) throw new Error(`Server '${name}' not found`);
    this.servers.splice(index, 1);
    this.clients.get(name)?.disconnect();
    this.clients.delete(name);
    await this.saveConfig();
  }

  private ensureClient(name: string): MCPClientWrapper {
    const existing = this.clients.get(name);
    if (existing) return existing;

    const config = this.servers.find((s) => s.name === name);
    if (!config) throw new Error(`Server '${name}' not found`);

    const client = new MCPClientWrapper(config);
    this.clients.set(name, client);
    return client;
  }

  getMcpClient(name: string): MCPClientWrapper {
    return this.ensureClient(name);
  }

  createAllClients(): void {
    this.servers.forEach((s) => {
      this.ensureClient(s.name);
    });
  }

  async connectAll(): Promise<void> {
    this.createAllClients();
    for (const client of this.clients.values()) {
      try {
        await client.connect();
      } catch (e) {
        console.error(`[MCPOrchestrator] Failed to connect to '${client.name}':`, e);
      }
    }
  }

  listClientNames(): string[] {
    return Array.from(this.clients.keys());
  }

  getConnectedClients(): MCPClientWrapper[] {
    return Array.from(this.clients.values());
  }

  /**
   * Gather tools from all (optionally filtered) MCP clients and conduct an LLM tool-call loop
   * until the model returns a final answer (finish_reason === 'stop'). Returns the final
   * assistant message content (string | null) and the raw transcript for auditing.
   */
  async processMessage(
    prompt: string,
    options: {
      serverFilter?: string[]; // if provided, only include tools from these servers
      systemPrompt?: string;
      maxToolIterations?: number; // safety cap to avoid infinite loops
    } = {},
  ): Promise<{
    final: string | null;
    transcript: ChatCompletionMessageParam[];
  }> {
    // Check if LLM client is configured
    if (!this.llmClient.isConfigured()) {
      throw new Error(
        "OpenAI is not configured. MCP features require OpenAI API key or Azure OpenAI configuration.",
      );
    }

    // Ensure servers are created (and connect lazily when listing tools)
    const availableServers = await this.listAvailableServers();
    const serverFilter = options.serverFilter;
    const targetServers = serverFilter?.length
      ? availableServers.filter((s) => serverFilter.includes(s.name))
      : availableServers;

    const toolDefs: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
    for (const server of targetServers) {
      const client = this.getMcpClient(server.name);
      try {
        await client.connect();
        const toolList = await client.listTools();
        const sanitizedServerName = MCPOrchestrator.sanitizeServerName(server.name);

        toolList.tools?.forEach((tool) => {
          const sanitizedToolName = MCPOrchestrator.sanitizeServerName(tool.name);
          toolDefs.push({
            type: "function",
            function: {
              name: `${sanitizedServerName}__${sanitizedToolName}`,
              description: tool.description || `Tool ${tool.name} from ${server.name}`,
              parameters: tool.inputSchema || {
                type: "object",
                properties: {},
              },
            },
          });
        });
      } catch (e) {
        console.warn(`[MCPOrchestrator] Failed to load server ${server.name}`, e);
      }
    }

    const systemPrompt =
      options.systemPrompt ??
      "You are a helpful AI that can call tools. Use the provided tools to satisfy the user request. When you have the final answer, respond normally so the session can end.";

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    this.sendStepEvent({ type: "start", message: "Start execute task" });

    const maxIterations = options.maxToolIterations ?? 30;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const llmResponse = await this.llmClient.sendMessage(messages, toolDefs);
      const choice = llmResponse.choices[0];
      const assistantMessage = choice.message;
      if (assistantMessage) messages.push(assistantMessage);

      if (choice.finish_reason === "stop") {
        // Send final result event
        this.sendStepEvent({
          type: "final_result",
          message: "Generate final result",
        });
        return {
          final: assistantMessage?.content ?? null,
          transcript: messages,
        };
      }

      const toolCalls = assistantMessage?.tool_calls;
      if (!toolCalls?.length) {
        console.warn("[MCPOrchestrator] No tool calls and not finished; aborting loop.");
        break;
      }

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;

        const [serverName, toolName] = tc.function.name.split("__", 2);
        if (!serverName || !toolName) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Error: Unable to parse tool routing for ${tc.function.name}`,
          });
          continue;
        }

        const originalServerName =
          this.servers.find((s) => MCPOrchestrator.sanitizeServerName(s.name) === serverName)
            ?.name ?? serverName;

        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};

        this.sendStepEvent({
          type: "tool_call",
          toolName,
          serverName: originalServerName,
          args,
          timestamp: Date.now(),
        });

        try {
          const client = this.getMcpClient(serverName);
          const result = await client.callTool(toolName, args);

          this.sendStepEvent({
            type: "tool_result",
            toolName,
            serverName: originalServerName,
            result,
            timestamp: Date.now(),
          });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          this.sendStepEvent({
            type: "tool_result",
            toolName,
            serverName: originalServerName,
            error: String(err),
            timestamp: Date.now(),
          });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Tool call failed: ${String(err)}`,
          });
        }
      }
    }

    return { final: null, transcript: messages };
  }
}
