import { LLMClientProvider } from "./llm-client-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { VideoUploadResult } from "../auth/types";
import { ModelMessage } from "ai";

export class MCPOrchestratorNeo {
    private static instance: MCPOrchestratorNeo;
    private static llmProvider: LLMClientProvider | null = null;
    private static mcpServerManager: MCPServerManager | null = null;

    private constructor() { }

    public static async getInstanceAsync(): Promise<MCPOrchestratorNeo> {
        if (MCPOrchestratorNeo.instance) {
            return MCPOrchestratorNeo.instance;
        }
        MCPOrchestratorNeo.instance = new MCPOrchestratorNeo();

        // Initialize LLM provider
        MCPOrchestratorNeo.llmProvider = await LLMClientProvider.getInstanceAsync();

        // Initialize MCP server manager
        MCPOrchestratorNeo.mcpServerManager = await MCPServerManager.getInstanceAsync();

        return MCPOrchestratorNeo.instance;
    }

    public async processMessageAsync(
        prompt: string,
        videoUploadResult?: VideoUploadResult,
        options: {
            serverFilter?: string[]; // if provided, only include tools from these servers
            systemPrompt?: string;
            maxToolIterations?: number; // safety cap to avoid infinite loops
        } = {}): Promise<any> {

        // Ensure LLM has been initialized
        if (!MCPOrchestratorNeo.llmProvider) {
            throw new Error("[MCPOrchestratorNeo]: LLM client not initialized");
        }

        // Ensure MCP server manager is initialized
        const serverManager = MCPOrchestratorNeo.mcpServerManager;
        if (!serverManager) {
            throw new Error("[MCPOrchestratorNeo]: MCP server manager not initialized");
        }

        // Get tools and apply the server filter if provided
        const tools = await serverManager.collectToolsAsync(options.serverFilter);

        let systemPrompt =
            options.systemPrompt ??
            "You are a helpful AI that can call tools. Use the provided tools to satisfy the user request. When you have the final answer, respond normally so the session can end.";

        const videoUrl = videoUploadResult?.data?.url;
        if (videoUrl) {
            systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.\nPlease include this URL in the task content that you create.`;
        }

        const messages: ModelMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ];

        const { text, steps, reasoning } = await MCPOrchestratorNeo.llmProvider.sendMessage(messages, tools);

        return text;
    }
}