import type { ToolCallOptions, ToolModelMessage, ModelMessage, UserModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import type { VideoUploadResult } from "../auth/types";
import { LLMClientProvider } from "./llm-client-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { BrowserWindow } from "electron";
import { GeneralSettingsStorage, type ToolApprovalMode } from "../storage/general-settings-storage";

type StepType =
  | "start"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "final_result"
  | "tool_approval_required"
  | "tool_denied";

export type ToolApprovalDecision =
  | { kind: "approve" }
  | { kind: "deny_stop"; feedback?: string }
  | { kind: "request_changes"; feedback: string };

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
  autoApproveAt?: number;
}

const WAIT_MODE_AUTO_APPROVE_DELAY_MS = 15_000;

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
  private pendingToolApprovals = new Map<string, (decision: ToolApprovalDecision) => void>();

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
    const tools = await serverManager.collectToolsWithServerPrefixAsync();
    const generalSettingsStorage = GeneralSettingsStorage.getInstance();

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
    for (let i = 0; i < (options.maxToolIterations || 20); i++) {
      const generalSettings = await generalSettingsStorage.getSettingsAsync();
      const toolApprovalMode: ToolApprovalMode = generalSettings.toolApprovalMode;
      const bypassApprovalChecks = toolApprovalMode === "yolo";
      const toolWhiteList = bypassApprovalChecks
        ? new Set<string>()
        : new Set(
            (await MCPOrchestrator.mcpServerManager?.getWhitelistWithServerPrefixAsync()) ?? [],
          );

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

      // Handle llmResponse based on finishReason
      if (llmResponse.finishReason === "tool-calls") {
        let retryFeedback: { message: string; userVisibleMessage: string } | null = null;
        for (const toolCall of llmResponse.toolCalls) {
          const requiresApproval = !bypassApprovalChecks && !toolWhiteList.has(toolCall.toolName);

          if (requiresApproval) {
            const autoApproveAt =
              toolApprovalMode === "wait"
                ? Date.now() + WAIT_MODE_AUTO_APPROVE_DELAY_MS
                : undefined;
            const { decision, requestId } = await this.requestToolApproval(
              toolCall.toolName,
              toolCall.input,
              { autoApproveAt },
            );

            if (decision.kind === "deny_stop") {
              const denialMessage = decision.feedback?.trim()?.length
                ? `User cancelled tool: ${decision.feedback.trim()}`
                : "Tool execution cancelled by user";
              sendStepEvent({
                type: "tool_denied",
                toolName: toolCall.toolName,
                args: toolCall.input,
                requestId,
                message: denialMessage,
              });
              sendStepEvent({
                type: "final_result",
                message: "Tool execution cancelled by user",
              });
              return "Tool execution cancelled by user";
            }

            if (decision.kind === "request_changes") {
              const formattedFeedback = decision.feedback.trim();
              const userVisibleMessage = formattedFeedback
                ? `User feedback: ${formattedFeedback}`
                : "User requested tool changes";
              retryFeedback = {
                message: this.formatToolCorrectionMessage(
                  toolCall.toolName,
                  toolCall.input,
                  formattedFeedback,
                ),
                userVisibleMessage,
              };
              sendStepEvent({
                type: "tool_denied",
                toolName: toolCall.toolName,
                args: toolCall.input,
                requestId,
                message: userVisibleMessage,
              });

              // construct tool result message and append to messages history
              const toolMessage: ToolModelMessage = {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolName: toolCall.toolName,
                    toolCallId: toolCall.toolCallId,
                    output: {
                      type: "error-text",
                      value: retryFeedback.message,
                    },
                  },
                ],
              };

              // LLM ignores the retry feedback in the tool result, so we need to add a user message as well
              const userMessage: UserModelMessage = {
                role: "user",
                content: retryFeedback.message,
              };

              messages.push(toolMessage, userMessage);
              continue;
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
    const tools = await serverManager.collectToolsWithServerPrefixAsync();

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

  private formatToolCorrectionMessage(
    toolName: string,
    originalArgs: unknown,
    feedback: string,
  ): string {
    const serializedArgs = (() => {
      try {
        return JSON.stringify(originalArgs, null, 2);
      } catch {
        return String(originalArgs ?? "");
      }
    })();

    const feedbackLines = [
      `Please revise the previous call to "${toolName}".`,
      feedback ? `User feedback: ${feedback}` : undefined,
      serializedArgs ? `Previous arguments were:\n${serializedArgs}` : undefined,
      "Update your plan or choose a different tool before continuing.",
    ].filter(Boolean);

    return feedbackLines.join("\n\n");
  }

  private async requestToolApproval(
    toolName: string,
    args: unknown,
    options?: { autoApproveAt?: number },
  ): Promise<{ requestId: string; decision: ToolApprovalDecision }> {
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
      autoApproveAt: options?.autoApproveAt,
    });

    const TOOL_APPROVAL_TIMEOUT_MS = 60_000; // 60 seconds
    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      // Store resolver for normal approval/denial
      this.pendingToolApprovals.set(requestId, (result: ToolApprovalDecision) => {
        clearTimeout(timeoutId);
        this.pendingToolApprovals.delete(requestId);
        resolve(result);
      });
      // Timeout fallback
      const timeoutId = setTimeout(() => {
        this.pendingToolApprovals.delete(requestId);
        resolve({ kind: "deny_stop" }); // Denied by timeout
      }, TOOL_APPROVAL_TIMEOUT_MS);
    });

    return { requestId, decision };
  }

  public resolveToolApproval(requestId: string, decision: ToolApprovalDecision): boolean {
    const resolver = this.pendingToolApprovals.get(requestId);
    if (!resolver) {
      return false;
    }

    this.pendingToolApprovals.delete(requestId);
    resolver(decision);
    return true;
  }
}
