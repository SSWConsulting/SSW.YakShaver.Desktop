import { GenerateTextResult, ToolCallOptions, ToolModelMessage, type ModelMessage } from "ai";
import type { VideoUploadResult } from "../auth/types";
import { LLMClientProvider } from "./llm-client-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { BrowserWindow } from "electron";

type StepType = "start" | "reasoning" | "tool_call" | "tool_result" | "final_result";

interface MCPStep {
  type: StepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  timestamp?: number;
}

function sendStepEvent(event: MCPStep): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("mcp:step-update", event);
    }
  }
}

export class MCPOrchestrator {
  private static instance: MCPOrchestrator;
  private static llmProvider: LLMClientProvider | null = null;
  private static mcpServerManager: MCPServerManager | null = null;

  private constructor() {}

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

  public async manualLoopAsync(
    prompt: string,
    videoUploadResult?: VideoUploadResult,
    options: {
      serverFilter?: string[]; // if provided, only include tools from these servers
      systemPrompt?: string;
      maxToolIterations?: number; // safety cap to avoid infinite loops
    } = {},
  ): Promise<any> {
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

    // the orchestrator loop
    for (let i = 0; i < (options.maxToolIterations || 10); i++) {
      let llmResponse: GenerateTextResult<any, any>;
      try {
        llmResponse = await MCPOrchestrator.llmProvider.generateTextWithTools(messages, tools);
      } catch (error) {
        console.log("[MCPOrchestrator]: Error in processMessageAsync:", error);
        throw error;
      }

      if (!llmResponse) {
        throw new Error("[MCPOrchestrator]: No response from LLM provider");
      }

      // Add LLM generated messages to the message history
      const responseMessages = llmResponse.response.messages;
      messages.push(...responseMessages);

      if (llmResponse.finishReason === "tool-calls") {
        for (const toolCall of llmResponse.toolCalls) {
          llmResponse.reasoning;
          // send event to UI about tool call
          sendStepEvent({ type: "tool_call", toolName: toolCall.toolName, args: toolCall.input });
          console.log("Executing tool:", toolCall.toolName);

          const toolToCall = tools[toolCall.toolName];
          if (toolToCall?.execute) {
            const toolOutput = await toolToCall.execute(toolCall.input, {
              toolCallId: toolCall.toolCallId,
            } as ToolCallOptions);

            // send event to UI about tool result
            sendStepEvent({ type: "tool_result", toolName: toolCall.toolName, result: toolOutput });

            // construct tool result message and append to messages history
            const toolMessage: ToolModelMessage = {
              role: "tool",
              content: [
                {
                  toolName: toolCall.toolName,
                  toolCallId: toolCall.toolCallId,
                  type: "tool-result",
                  output: {
                    type: toolOutput.content[0].type,
                    value: toolOutput.content[0].text,
                  },
                },
              ],
            };

            messages.push(toolMessage);
          }
        }
      } else if (llmResponse.finishReason === "stop") {
        console.log("Final message history by stop:");
        console.log(llmResponse.text);

        // send final result event to UI
        sendStepEvent({ type: "final_result", message: llmResponse.finishReason });
        return llmResponse.text;
      } else if (llmResponse.finishReason === "content-filter") {
        console.log("Conversation ended due to content filter. ");
        return "Conversation ended due to content filter.";
      } else if (llmResponse.finishReason === "length") {
        console.log("Conversation ended due to length limit. ");
        return "Conversation ended due to length limit.";
      } else {
        console.log("Conversation ended by error or unknown stop. Reason: ");
        console.log(llmResponse.finishReason);
        break;
      }
    }
  }

  public async autoLoopAsync(
    prompt: string,
    videoUploadResult?: VideoUploadResult,
    options: {
      serverFilter?: string[]; // if provided, only include tools from these servers
      systemPrompt?: string;
      maxToolIterations?: number; // safety cap to avoid infinite loops
    } = {},
  ): Promise<any> {
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

    //  this is the AI SDK's automatic orchestrator loop, can be used for YOLO mode
    const response = await MCPOrchestrator.llmProvider.sendMessage(messages, tools);
    return response.text;
  }
}
