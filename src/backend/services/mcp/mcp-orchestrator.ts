import type { ToolCallOptions, ToolModelMessage, ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import type { VideoUploadResult } from "../auth/types";
import { LLMClientProvider } from "./llm-client-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { BrowserWindow } from "electron";
import { McpStorage } from "../storage/mcp-storage";

type StepType =
  | "start"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "final_result"
  | "tool_approval_required"
  | "tool_denied";

interface MCPStep {
  type: StepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  requestId?: string;
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
  private pendingToolApprovals = new Map<string, (approved: boolean) => void>();

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
  ): Promise<string | undefined> {
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

    const McpConfigs = await McpStorage.getInstance().getMcpServerConfigsAsync();
    const toolWhiteList = new Set(McpConfigs.flatMap((config) => config?.toolWhitelist ?? []));

    // the orchestrator loop
    for (let i = 0; i < (options.maxToolIterations || 10); i++) {
      const llmResponse = await MCPOrchestrator.llmProvider
        .generateTextWithTools(messages, tools)
        .catch((error) => {
          console.log("[MCPOrchestrator]: Error in processMessageAsync:", error);
          throw error;
        });

      if (!llmResponse) {
        throw new Error("[MCPOrchestrator]: No response from LLM provider");
      }

      // Add LLM generated messages to the message history
      const responseMessages = llmResponse.response.messages;
      messages.push(...responseMessages);

      if (llmResponse.finishReason === "tool-calls") {
        for (const toolCall of llmResponse.toolCalls) {
          const requiresApproval = !toolWhiteList.has(toolCall.toolName);

          if (requiresApproval) {
            const { approved, requestId } = await this.requestToolApproval(
              toolCall.toolName,
              toolCall.input,
            );

            if (!approved) {
              sendStepEvent({
                type: "tool_denied",
                toolName: toolCall.toolName,
                args: toolCall.input,
                requestId,
                message: "User denied tool execution",
              });
              sendStepEvent({
                type: "final_result",
                message: "Tool execution cancelled by user",
              });
              return "Tool execution cancelled by user";
            }
          }

          // send event to UI about tool call now that it is approved/whitelisted
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
  ): Promise<string> {
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

  private async requestToolApproval(
    toolName: string,
    args: unknown,
  ): Promise<{ requestId: string; approved: boolean }> {
    if (!MCPOrchestrator.instance) {
      throw new Error("[MCPOrchestrator]: requestToolApproval called before initialization");
    }

    const requestId = randomUUID();
    sendStepEvent({
      type: "tool_approval_required",
      toolName,
      args,
      requestId,
      message: `Approval required to run ${toolName}`,
    });

    const approved = await new Promise<boolean>((resolve) => {
      this.pendingToolApprovals.set(requestId, resolve);
    });

    return { requestId, approved };
  }

  public resolveToolApproval(requestId: string, approved: boolean): boolean {
    const resolver = this.pendingToolApprovals.get(requestId);
    if (!resolver) {
      return false;
    }

    this.pendingToolApprovals.delete(requestId);
    resolver(approved);
    return true;
  }
}
