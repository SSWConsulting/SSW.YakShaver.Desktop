import { randomUUID } from "node:crypto";
import type { ToolApprovalMode } from "@shared/types/user-settings";
import type { ModelMessage, ToolExecutionOptions, ToolModelMessage, UserModelMessage } from "ai";
import { BrowserWindow } from "electron";
import type { ZodType } from "zod";
import type { MCPStep, ToolApprovalDecision } from "../../../shared/types/mcp";
import type { VideoUploadResult } from "../auth/types";
import { UserSettingsStorage } from "../storage/user-settings-storage";
import { LanguageModelProvider } from "./language-model-provider";
import { MCPServerManager } from "./mcp-server-manager";

/**
 * Tool Output Buffer for host-level tool chaining.
 * Stores raw tool outputs so subsequent tools can reference them by ID, avoiding content modification by the LLM during chaining.
 */
export class ToolOutputBuffer {
  private static instance: ToolOutputBuffer;
  private outputs: Map<string, { toolName: string; content: string; timestamp: number }> =
    new Map();

  private constructor() {}

  public static getInstance(): ToolOutputBuffer {
    if (!ToolOutputBuffer.instance) {
      ToolOutputBuffer.instance = new ToolOutputBuffer();
    }
    return ToolOutputBuffer.instance;
  }

  public store(toolName: string, content: string): string {
    const id = `tool_output_${randomUUID().slice(0, 8)}`;
    this.outputs.set(id, {
      toolName,
      content,
      timestamp: Date.now(),
    });
    return id;
  }

  public get(id: string): string | undefined {
    const entry = this.outputs.get(id);
    if (entry) {
      return entry.content;
    }
    console.warn(`[ToolOutputBuffer] Output not found for ID: ${id}`);
    return undefined;
  }

  public has(id: string): boolean {
    return this.outputs.has(id);
  }

  public getMetadata(
    id: string,
  ): { toolName: string; contentLength: number; timestamp: number } | undefined {
    const entry = this.outputs.get(id);
    if (entry) {
      return {
        toolName: entry.toolName,
        contentLength: entry.content.length,
        timestamp: entry.timestamp,
      };
    }
    return undefined;
  }

  public clear(): void {
    this.outputs.clear();
  }

  public listAll(): Array<{ id: string; toolName: string; contentLength: number }> {
    return Array.from(this.outputs.entries()).map(([id, entry]) => ({
      id,
      toolName: entry.toolName,
      contentLength: entry.content.length,
    }));
  }
}

const WAIT_MODE_AUTO_APPROVE_DELAY_MS = 15_000;

// TODO: Separate the ApprovalDialog event trigger from this, and remove this event sender
// ISSUE: https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/602
function sendStepEvent(event: MCPStep): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("mcp:step-update", event);
    }
  }
}

export class MCPOrchestrator {
  private static instance: MCPOrchestrator;

  private static languageModelProvider: LanguageModelProvider | null = null;
  private static mcpServerManager: MCPServerManager | null = null;
  private pendingToolApprovals = new Map<string, (decision: ToolApprovalDecision) => void>();

  private constructor() {}

  private resolveToolOutputReferences(input: Record<string, unknown>): Record<string, unknown> {
    const outputBuffer = ToolOutputBuffer.getInstance();
    const resolved: Record<string, unknown> = { ...input };

    for (const [key, value] of Object.entries(input)) {
      // Check if the parameter name is "toolOutputRef" and the value is a string reference
      if (key === "toolOutputRef" && typeof value === "string") {
        const content = outputBuffer.get(value);
        if (content) {
          // Replace toolOutputRef with the actual content in a standard parameter name
          // Use "template" as the default resolved parameter name, but tools can customize this
          delete resolved.toolOutputRef;
          resolved.template = content;
          console.log(
            `[MCPOrchestrator] Resolved toolOutputRef '${value}' (${content.length} chars)`,
          );
        } else {
          console.warn(
            `[MCPOrchestrator] Tool output reference '${value}' not found in buffer. Available: ${JSON.stringify(outputBuffer.listAll())}`,
          );
        }
      }
    }

    return resolved;
  }

  public static async getInstanceAsync(): Promise<MCPOrchestrator> {
    if (MCPOrchestrator.instance) {
      return MCPOrchestrator.instance;
    }
    MCPOrchestrator.instance = new MCPOrchestrator();

    // Initialize LLM provider
    MCPOrchestrator.languageModelProvider = await LanguageModelProvider.getInstance();

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
      videoFilePath?: string; // local video file path for screenshot capture
      serverFilter?: string[]; // if provided, only include tools from these server IDs
      onStep?: (step: MCPStep) => void;
    } = {},
  ): Promise<string | undefined> {
    // Ensure LLM has been initialized
    if (!MCPOrchestrator.languageModelProvider) {
      throw new Error("[MCPOrchestrator]: LLM client not initialized");
    }

    // Ensure MCP server manager is initialized
    const serverManager = MCPOrchestrator.mcpServerManager;
    if (!serverManager) {
      throw new Error("[MCPOrchestrator]: MCP server manager not initialized");
    }

    // Get tools and apply the server filter if provided
    const tools = await serverManager.collectToolsWithServerPrefixAsync();
    const userSettingsStorage = UserSettingsStorage.getInstance();

    let systemPrompt =
      options.systemPrompt ??
      "You are a helpful AI that can call tools. Use the provided tools to satisfy the user request. When you have the final answer, respond normally so the session can end.";

    const videoUrl = videoUploadResult?.data?.url;
    if (videoUrl) {
      systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.\nPlease include this URL in the task content that you create.`;
    }

    // If a video file path is provided, add it to the system prompt for screenshot capture
    if (options.videoFilePath) {
      systemPrompt += `\n\nVideo file available for screenshot capture: ${options.videoFilePath}.`;
    }

    const messages: ModelMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      // Reason why it has to be done like this right now: see https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/420#issuecomment-3684664177
      {
        role: "system",
        content: "When selecting tools, briefly explain the reason for choosing them.",
      },
      { role: "user", content: prompt },
    ];

    // the orchestrator loop
    for (let i = 0; i < (options.maxToolIterations || 20); i++) {
      const toolApprovalSettings = await userSettingsStorage.getSettingsAsync();
      const toolApprovalMode: ToolApprovalMode = toolApprovalSettings.toolApprovalMode;
      const bypassApprovalChecks = toolApprovalMode === "yolo";
      const toolWhiteList = bypassApprovalChecks
        ? new Set<string>()
        : new Set(
            (await MCPOrchestrator.mcpServerManager?.getWhitelistWithServerPrefixAsync()) ?? [],
          );

      const llmResponse = await MCPOrchestrator.languageModelProvider
        .generateTextWithTools(messages, tools)
        .catch((error) => {
          console.error("[MCPOrchestrator] Error generating response from LLM:", error);
          throw error;
        });

      if (!llmResponse) {
        throw new Error("[MCPOrchestrator]: No response from LLM provider");
      }

      // Add LLM generated messages to the message history
      const responseMessages = llmResponse.response.messages;
      messages.push(...responseMessages);

      const reasoningContent = llmResponse.content.find((resp) => resp.type === "text");
      if (reasoningContent && llmResponse.finishReason !== "stop") {
        sendStepEvent({
          type: "reasoning",
          reasoning: JSON.stringify(reasoningContent),
        });
        options.onStep?.({
          type: "reasoning",
          reasoning: JSON.stringify(reasoningContent),
        });
      }

      // Handle llmResponse based on finishReason
      if (llmResponse.finishReason === "tool-calls") {
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
              { autoApproveAt, onStep: options.onStep },
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
              options.onStep?.({
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
              options.onStep?.({
                type: "final_result",
                message: "Tool execution cancelled by user",
              });
              return "Tool execution cancelled by user";
            }

            if (decision.kind === "request_changes") {
              let retryFeedback: { message: string; userVisibleMessage: string } | null = null;
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
              options.onStep?.({
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
          sendStepEvent({
            type: "tool_call",
            toolName: toolCall.toolName,
            args: toolCall.input,
          });
          options.onStep?.({
            type: "tool_call",
            toolName: toolCall.toolName,
            args: toolCall.input,
          });
          console.log("Executing tool:", toolCall.toolName);

          const toolToCall = tools[toolCall.toolName];

          if (toolToCall?.execute) {
            try {
              // Resolve any toolOutputRef parameters before executing the tool
              const resolvedInput = this.resolveToolOutputReferences(toolCall.input);

              const toolOutput = await toolToCall.execute(resolvedInput, {
                toolCallId: toolCall.toolCallId,
              } as ToolExecutionOptions);

              const rawOutputText =
                toolOutput.content
                  .map((item: { text?: string; type?: string; resource?: { text?: string } }) => {
                    if (item.text) return item.text;
                    if (item.type === "resource" && item.resource?.text) {
                      return item.resource.text;
                    }
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n\n") || "(no text output)";

              // Store complete raw output in buffer for tool chaining
              const contentToStore = JSON.stringify(toolOutput.content);
              const outputBuffer = ToolOutputBuffer.getInstance();
              const outputRefId = outputBuffer.store(toolCall.toolName, contentToStore);

              // send event to UI about tool result
              sendStepEvent({
                type: "tool_result",
                toolName: toolCall.toolName,
                result: toolOutput,
              });
              options.onStep?.({
                type: "tool_result",
                toolName: toolCall.toolName,
                result: toolOutput,
              });

              // Construct tool result message with buffer reference for tool chaining
              const toolResultValue = `${rawOutputText}\n\n[Tool Output Reference: ${outputRefId}] - Use this ID to reference the raw output in subsequent tool calls that accept a 'toolOutputRef' parameter.`;

              const toolMessage: ToolModelMessage = {
                role: "tool",
                content: [
                  {
                    toolName: toolCall.toolName,
                    toolCallId: toolCall.toolCallId,
                    type: "tool-result",
                    output: {
                      type: toolOutput.content[0].type,
                      value: toolResultValue,
                    },
                  },
                ],
              };

              messages.push(toolMessage);
            } catch (toolError) {
              console.error(
                `[MCPOrchestrator] TOOL ERROR: ${toolCall.toolName} (${toolCall.toolCallId})`,
                toolError,
              );
              throw toolError;
            }
          } else {
            console.warn(
              `[MCPOrchestrator] Tool '${toolCall.toolName}' not found or has no execute method`,
            );
          }
        }
      } else if (llmResponse.finishReason === "stop") {
        console.log("Final message history by stop:");
        console.log(llmResponse.text);

        // Clear the tool output buffer at session end
        ToolOutputBuffer.getInstance().clear();

        // send final result event to UI
        sendStepEvent({
          type: "final_result",
          message: llmResponse.finishReason,
        });
        options.onStep?.({
          type: "final_result",
          message: llmResponse.finishReason,
        });
        return llmResponse.text;
      } else if (llmResponse.finishReason === "content-filter") {
        console.log("[MCPOrchestrator] Session ended: Content filter triggered");
        ToolOutputBuffer.getInstance().clear();
        return "Conversation ended due to content filter.";
      } else if (llmResponse.finishReason === "length") {
        console.log("[MCPOrchestrator] Session ended: Maximum length reached");
        ToolOutputBuffer.getInstance().clear();
        return "Conversation ended due to length limit.";
      } else {
        console.log("[MCPOrchestrator] Session ended with unknown reason:");
        console.log(llmResponse.finishReason);
        ToolOutputBuffer.getInstance().clear();
        break;
      }
    }
  }

  public async convertToObjectAsync(prompt: string, schema: ZodType): Promise<unknown> {
    if (!MCPOrchestrator.languageModelProvider) {
      throw new Error("[MCPOrchestrator]: LLM client not initialized");
    }

    try {
      const objResult = await MCPOrchestrator.languageModelProvider.generateObject(prompt, schema);
      return objResult;
    } catch (error) {
      console.error("[MCPOrchestrator]: Error in convertToObjectAsync:", error);
      throw error;
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
    if (!MCPOrchestrator.languageModelProvider) {
      throw new Error("[MCPOrchestrator]: LLM client not initialized");
    }

    // Ensure MCP server manager is initialized
    const serverManager = MCPOrchestrator.mcpServerManager;
    if (!serverManager) {
      throw new Error("[MCPOrchestrator]: MCP server manager not initialized");
    }

    // Get tools and apply the server filter if provided
    const tools = await serverManager.collectToolsForSelectedServersAsync(options.serverFilter);

    let systemPrompt =
      options.systemPrompt ??
      "You are a helpful AI that can call tools. Use the provided tools to satisfy the user request. When you have the final answer, respond normally so the session can end.";

    const videoUrl = videoUploadResult?.data?.url;
    const duration = videoUploadResult?.data?.duration;
    if (videoUrl) {
      const isValidDuration = typeof duration === "number" && duration > 0;

      if (isValidDuration) {
        const getDurationParts = (seconds: number) => {
          const hours = Math.floor(seconds / 3600);
          const mins = Math.floor((seconds % 3600) / 60);
          const secs = Math.floor(seconds % 60);
          return { totalSeconds: seconds, hours, minutes: mins, seconds: secs };
        };
        const outputDuration = getDurationParts(duration);
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Video duration:
- totalSeconds: ${outputDuration.totalSeconds}
- hours: ${outputDuration.hours}
- minutes: ${outputDuration.minutes} 
- seconds: ${outputDuration.seconds}
Embed this URL and duration in the task content that you create. Follow user requirements STRICTLY about the link formatting rule.`;
      } else {
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Video duration is currently unknown.
Embed this URL in the task content that you create. Follow user requirements STRICTLY about the link formatting rule.`;
      }
    }

    const messages: ModelMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    //  this is the AI SDK's automatic orchestrator loop, can be used for YOLO mode
    const response = await MCPOrchestrator.languageModelProvider.sendMessage(messages, tools);
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
    options?: { autoApproveAt?: number; onStep?: (step: MCPStep) => void },
  ): Promise<{ requestId: string; decision: ToolApprovalDecision }> {
    if (!MCPOrchestrator.instance) {
      throw new Error("[MCPOrchestrator]: requestToolApproval called before initialization");
    }

    const requestId = randomUUID();
    const event: MCPStep = {
      type: "tool_approval_required",
      toolName,
      args,
      requestId,
      message: `Approval required to run ${toolName}`,
      autoApproveAt: options?.autoApproveAt,
    };
    sendStepEvent(event);
    options?.onStep?.(event);

    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      // Store resolver for normal approval/denial
      this.pendingToolApprovals.set(requestId, (result: ToolApprovalDecision) => {
        this.pendingToolApprovals.delete(requestId);
        resolve(result);
      });
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

  public cancelAllPendingApprovals(reason = "Session cancelled"): void {
    for (const resolve of this.pendingToolApprovals.values()) {
      resolve({ kind: "deny_stop", feedback: reason });
    }
    this.pendingToolApprovals.clear();
  }
}
