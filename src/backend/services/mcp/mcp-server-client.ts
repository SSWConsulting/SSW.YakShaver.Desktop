import { experimental_createMCPClient, experimental_MCPClient } from "@ai-sdk/mcp";
import { MCPServerConfig } from "./types";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPUtils } from "./mcp-utils";
import { formatErrorMessage } from "../../utils/error-utils";

// Minimal tool interface based on MCP spec; allows additional provider-specific fields.
export interface MCPTool {
    name: string;
    description?: string;
    input_schema?: unknown;
    // Allow arbitrary extra metadata without forcing any.
    [key: string]: unknown;
}

// A tool set can be an array or an object keyed by tool name.
export type MCPToolSet = MCPTool[] | Record<string, MCPTool>;


export class MCPServerClient {
    public mcpClientName: string;
    private mcpClient: experimental_MCPClient;

    private constructor(name: string, client: experimental_MCPClient) {
        this.mcpClientName = name;
        this.mcpClient = client;
    }

    public static async createClientAsync(mcpConfig: MCPServerConfig): Promise<MCPServerClient> {
        // create streamableHttp transport MCP client
        if (mcpConfig.transport === "streamableHttp") {
            const client = await experimental_createMCPClient({
                transport: {
                    type: "http",
                    url: MCPUtils.expandHomePath(mcpConfig.url),
                    headers: mcpConfig.headers,
                }
            });
            return new MCPServerClient(mcpConfig.name, client);
        }

        // create stdio transport MCP client
        if (mcpConfig.transport === "stdio") {
            if (!mcpConfig.command?.trim()) {
                throw new Error("Unsupported transport configuration: 'command' is required for stdio transports");
            }
            const command = MCPUtils.sanitizeSegment(mcpConfig.command);
            const args = mcpConfig.args
                ?.map((arg) => MCPUtils.sanitizeSegment(arg))
                .filter((arg) => arg.length > 0);
            const cwd = mcpConfig.cwd ? MCPUtils.expandHomePath(mcpConfig.cwd) : undefined;
            const mcpClient = await experimental_createMCPClient({
                transport: new StdioClientTransport({
                    command,
                    args,
                    env: mcpConfig.env,
                    stderr: mcpConfig.stderr,
                    cwd,
                }),
            });
            return new MCPServerClient(mcpConfig.name, mcpClient);
        }

        throw new Error(`Unsupported transport type: ${mcpConfig}`);
    }

    public async listToolsAsync(): Promise<MCPToolSet> {
        const raw = await this.mcpClient.tools();
        return raw as MCPToolSet;
    }

    public async toolCountAsync(): Promise<number> {
        try {
            const tools = await this.listToolsAsync();
            if (Array.isArray(tools)) {
                return tools.length;
            } else {
                return Object.keys(tools).length;
            }
        } catch (error) {
            throw new Error(`Failed to get tool count from MCP server: ${this.mcpClientName}. Error: ${formatErrorMessage(error)}`);
        }
    }

    public async healthCheckAsync(): Promise<{ healthy: boolean, toolCount: number }> {
        try {
            const toolCount = await this.toolCountAsync();
            return { healthy: true, toolCount: toolCount };
        } catch {
            return { healthy: false, toolCount: 0 };
        }
    }

    public async disconnectAsync(): Promise<void> {
        await this.mcpClient.close();
    }
}