import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InternalMcpTransportRegistry } from "./internal/internal-mcp-transport-registry.js";
import type { MCPServerConfig } from "./types";

export class MCPClientWrapper {
  private client: Client;
  private transport: StreamableHTTPClientTransport | StdioClientTransport | InMemoryTransport;
  private readonly serverConfig: MCPServerConfig;
  private isConnected = false;

  // Promise used to serialize concurrent connect() calls
  private connectPromise: Promise<void> | null = null;

  constructor(opts: MCPServerConfig) {
    this.serverConfig = opts;
    this.client = new Client({
      name: this.serverConfig.name,
      version: this.serverConfig.version || "1.0.0",
    });
    this.transport = this.buildTransport();
  }

  private buildTransport(): StreamableHTTPClientTransport | StdioClientTransport | InMemoryTransport {
    if (this.serverConfig.transport === "streamableHttp") {
      if (!this.serverConfig.url) {
        throw new Error(
          `MCP server '${this.serverConfig.name}' is missing a URL for streamableHttp transport`,
        );
      }
      const headers: Record<string, string> = {};
      if (this.serverConfig.headers) {
        for (const [k, v] of Object.entries(this.serverConfig.headers)) {
          headers[k] = v;
        }
      }
      const options: StreamableHTTPClientTransportOptions = {
        requestInit: { headers },
      };
      return new StreamableHTTPClientTransport(new URL(this.serverConfig.url), options);
    } else if (this.serverConfig.transport === "stdio") {
      if (!this.serverConfig.command) {
        throw new Error(
          `MCP server '${this.serverConfig.name}' is missing a command for stdio transport`,
        );
      }
      return new StdioClientTransport({
        command: this.serverConfig.command,
        args: this.serverConfig.args,
        env: this.serverConfig.env,
      });
    } else if (this.serverConfig.transport === "inMemory") {
      if (!this.serverConfig.inMemoryServerId) {
        throw new Error(
          `MCP server '${this.serverConfig.name}' is missing an inMemoryServerId for in-memory transport`,
        );
      }
      return InternalMcpTransportRegistry.getClientTransport(
        this.serverConfig.inMemoryServerId,
      );
    }
    throw new Error(`Unsupported transport: ${this.serverConfig.transport}`);
  }

  private isTransportStarted(): boolean {
    if (this.transport instanceof StreamableHTTPClientTransport) {
      const transport = this.transport as any;
      return transport?.started === true;
    }
    return false;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    // If a connect is already in progress, return the same promise
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      try {
        if (this.isTransportStarted()) {
          this.isConnected = true;
          return;
        }
        await this.client.connect(this.transport);
        this.isConnected = true;
        return;
      } catch (error) {
        console.error(`[MCP] Failed to connect to '${this.serverConfig.name}':`, error);
        throw error;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    // If a connect is in progress, await it first so we don't race with close
    if (this.connectPromise) {
      await this.connectPromise;
    }
    if (!this.isConnected) return;
    try {
      await this.client.close();
    } catch (error) {
      console.warn(`[MCP] Error while closing client '${this.serverConfig.name}':`, error);
    } finally {
      this.isConnected = false;
    }
  }

  async listTools() {
    return this.client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  get name() {
    return this.serverConfig.name;
  }
}
