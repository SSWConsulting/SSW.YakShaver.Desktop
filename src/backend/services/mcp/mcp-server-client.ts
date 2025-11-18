import { experimental_createMCPClient, experimental_MCPClient } from "@ai-sdk/mcp";
import { MCPServerConfig } from "./types";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { homedir } from "node:os";

const expandHomePath = (value: string): string => {
    if (!value) {
        return value;
    }

    if (value === "~") {
        return homedir();
    }

    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return `${homedir()}${value.slice(1)}`;
    }

    return value;
};

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
            if (!mcpConfig.command?.trim()) {
                throw new Error("Unsupported transport configuration: 'command' is required for stdio transports");
            }

            const normalizeSegment = (value: string): string => {
                let result = value.trim();

                if (result.endsWith(",")) {
                    result = result.slice(0, -1).trim();
                }

                if (
                    (result.startsWith("\"") && result.endsWith("\"")) ||
                    (result.startsWith("'") && result.endsWith("'"))
                ) {
                    result = result.slice(1, -1).trim();
                }

                return expandHomePath(result);
            };

            const command = normalizeSegment(mcpConfig.command);
            const args = mcpConfig.args
                ?.map((arg) => normalizeSegment(arg))
                .filter((arg) => arg.length > 0);
            const cwd = mcpConfig.cwd ? expandHomePath(mcpConfig.cwd) : undefined;

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