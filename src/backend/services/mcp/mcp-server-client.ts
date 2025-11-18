import { experimental_createMCPClient, experimental_MCPClient } from "@ai-sdk/mcp";
import { MCPServerConfig } from "./types";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPUtils } from "./mcp-utils";


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
                    url: MCPUtils.expandHomePath(mcpConfig.url),
                    headers: mcpConfig.headers,
                }
            });
            return new MCPServerClient(client);
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