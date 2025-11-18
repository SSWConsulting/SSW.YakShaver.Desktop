import { experimental_createMCPClient, experimental_MCPClient } from "@ai-sdk/mcp";
import { MCPServerConfig } from "./types";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class MCPServerClient {
    private mcpClient: experimental_MCPClient;

    private constructor(client: experimental_MCPClient) {
        this.mcpClient = client;
    }

    public static async createClientAsync(mcpConfig: MCPServerConfig): Promise<MCPServerClient> {
        // create streamableHttp transport MCP client
        if (mcpConfig.transport === "streamableHttp") {
            const client = await experimental_createMCPClient({
                transport: {
                    type: "http",
                    url: mcpConfig.url,
                    headers: mcpConfig.headers,
                }
            });
            return new MCPServerClient(client);
        }

        // create stdio transport MCP client
        if (mcpConfig.transport === "stdio") {
            const mcpClient = await experimental_createMCPClient({
                transport: new StdioClientTransport({
                    command: mcpConfig.command,
                    args: mcpConfig.args,
                }),
            });
            return new MCPServerClient(mcpClient);
        }

        throw new Error(`Unsupported transport type: ${mcpConfig}`);
    }

    public async listTools(): Promise<any> {
        return await this.mcpClient.tools();
    }

    public async disconnectAsync(): Promise<void> {
        await this.mcpClient.close();
    }
}