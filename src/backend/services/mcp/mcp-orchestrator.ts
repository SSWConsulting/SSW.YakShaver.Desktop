import { LLMClientProvider } from "./llm-client-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { VideoUploadResult } from "../auth/types";
import { ModelMessage } from "ai";

export class MCPOrchestrator {
    private static instance: MCPOrchestrator;
    private static llmProvider: LLMClientProvider | null = null;
    private static mcpServerManager: MCPServerManager | null = null;

    private constructor() { }

    public static async getInstanceAsync(): Promise<MCPOrchestrator> {
        if (MCPOrchestrator.instance) {
            return MCPOrchestrator.instance;
        }
        MCPOrchestrator.instance = new MCPOrchestrator();

        // Initialize LLM provider
        MCPOrchestrator.llmProvider = await LLMClientProvider.getInstanceAsync();

        // Initialize MCP server manager
        MCPOrchestrator.mcpServerManager = await MCPServerManager.getInstanceAsync();

        return MCPOrchestrator.instance;
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
        if (!MCPOrchestrator.llmProvider) {
            throw new Error("[MCPOrchestrator]: LLM client not initialized");
        }

        // Ensure MCP server manager is initialized
        const serverManager = MCPOrchestrator.mcpServerManager;
        if (!serverManager) {
            throw new Error("[MCPOrchestrator]: MCP server manager not initialized");
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

        const { text, steps, reasoning } = await MCPOrchestrator.llmProvider.sendMessage(messages, tools);

        return text;
    }
}