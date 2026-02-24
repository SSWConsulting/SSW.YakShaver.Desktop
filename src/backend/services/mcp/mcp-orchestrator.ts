import { randomUUID } from "node:crypto";
import type { ModelMessage, ToolExecutionOptions, ToolModelMessage, UserModelMessage } from "ai";
import type { ZodType } from "zod";
import type { MCPStep } from "../../../shared/types/mcp";
import { getDurationParts } from "../../utils/duration-utils";
import { formatAndReportError } from "../../utils/error-utils";
import type { VideoUploadResult } from "../auth/types";
import { UserInteractionService } from "../user-interaction/user-interaction-service";
import { TelemetryService } from "../telemetry/telemetry-service";
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

export class MCPOrchestrator {
  private static instance: MCPOrchestrator;

  private static languageModelProvider: LanguageModelProvider | null = null;
  private static mcpServerManager: MCPServerManager | null = null;

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
          delete resolved.toolOutputRef;
          resolved.content = content;
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
      projectDetailPrompt?: string;
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

    console.log(
      "[MCPOrchestrator] Starting manual loop with projectDetailPrompt:",
      options.projectDetailPrompt,
    );

    // Ensure MCP server manager is initialized
    const serverManager = MCPOrchestrator.mcpServerManager;
    if (!serverManager) {
      throw new Error("[MCPOrchestrator]: MCP server manager not initialized");
    }

    // Get tools and apply the server filter if provided
    const tools = await serverManager.collectToolsWithServerPrefixAsync();

    let systemPrompt = `You are a helpful AI that helps users achieve their goals. Use the provided tools to satisfy the user's request. When you have the final result, return it with a structured summary without questions so the session can end.
You will be given a **Project Prompt** and a **user video transcription** following the details of the project. Use this information to create tasks and call tools to get the job done.

**Project Prompt** - A detailed document that describes a project that is associated with the user's transcription. It may contain specific requirements, constraints, or guidelines that you MUST follow when creating tasks and calling tools. Always prioritize the instructions in the Project Prompt over any other information. If there is conflicting information, the Project Prompt takes precedence. Always follow the requirements in the Project Prompt STRICTLY. Do not deviate from the instructions in the Project Prompt.
**User Video Transcription** - A transcription of the user's video that may contain important information about the user's request, context, and requirements. Use the transcription to understand the user's needs and to extract relevant information that can help you create tasks and call tools effectively. The transcription is auto generated; although it provides context, it may contain typos. If there is any conflict between the transcription and the Project Prompt, prioritize the Project Prompt.

1. Do not ask the user for clarification, confirmation, or additional questions, the user will not be able to answer.
2. Do your best with the information you have and execute the tools you are given to achieve the user's goal.`;

    systemPrompt += options.projectDetailPrompt
      ? `\n---\nProject Prompt: ${options.projectDetailPrompt}`
      : "";

    systemPrompt = this.appendVideoInfoToSystemPrompt(
      systemPrompt,
      videoUploadResult,
      options.videoFilePath,
    );

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
        options.onStep?.({
          type: "reasoning",
          reasoning: JSON.stringify(reasoningContent),
        });
      }

      // Handle llmResponse based on finishReason
      if (llmResponse.finishReason === "tool-calls") {
        const telemetryService = TelemetryService.getInstance();
        for (const toolCall of llmResponse.toolCalls) {
          const toolWhiteList = new Set(
            (await MCPOrchestrator.mcpServerManager?.getWhitelistWithServerPrefixAsync()) ?? [],
          );
          const isWhitelisted = toolWhiteList.has(toolCall.toolName);
          const toolStartTime = Date.now();

          if (!isWhitelisted) {
            const requestId = randomUUID();

            const decision = await UserInteractionService.getInstance().requestToolApproval(
              toolCall.toolName,
              toolCall.input,
              { message: `Approval required to run ${toolCall.toolName}` },
            );

            if (decision.kind === "deny_stop") {
              const denialMessage = decision.feedback?.trim()?.length
                ? `User cancelled tool: ${decision.feedback.trim()}`
                : "Tool execution cancelled by user";

              // Track tool denial
              telemetryService.trackEvent({
                name: "MCPToolCall",
                properties: {
                  toolName: toolCall.toolName,
                  status: "denied",
                  serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                  denialReason: decision.feedback?.trim() || "user_cancelled",
                },
              });

              options.onStep?.({
                type: "tool_denied",
                toolName: toolCall.toolName,
                args: toolCall.input,
                requestId,
                message: denialMessage,
              });
              options.onStep?.({
                type: "final_result",
                message: "Tool execution cancelled by user",
              });
              return "Tool execution cancelled by user";
            }

            if (decision.kind === "request_changes") {
              // Track tool change request
              const durationMs = Date.now() - toolStartTime;
              telemetryService.trackEvent({
                name: "MCPToolCall",
                properties: {
                  toolName: toolCall.toolName,
                  status: "change_requested",
                  serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                  durationMs: durationMs.toString(),
                  feedback: decision.feedback?.trim() || "no_feedback",
                },
                measurements: {
                  duration: durationMs,
                },
              });

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
          options.onStep?.({
            type: "tool_call",
            toolName: toolCall.toolName,
            args: toolCall.input,
          });
          console.log("Executing tool:", toolCall.toolName);

          const toolToCall = tools[toolCall.toolName];

          if (toolToCall?.execute) {
            try {
              // Track tool call start
              telemetryService.trackEvent({
                name: "MCPToolCall",
                properties: {
                  toolName: toolCall.toolName,
                  status: "started",
                  serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                },
              });

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
              options.onStep?.({
                type: "tool_result",
                toolName: toolCall.toolName,
                result: toolOutput,
              });

              // Track successful tool completion
              const toolDuration = Date.now() - toolStartTime;
              telemetryService.trackEvent({
                name: "MCPToolCall",
                properties: {
                  toolName: toolCall.toolName,
                  status: "completed",
                  serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                  durationMs: toolDuration.toString(),
                },
                measurements: {
                  duration: toolDuration,
                },
              });

              // Construct tool result message with buffer reference for tool chaining
              const toolResultValue = `${rawOutputText}\n\n[Tool Output Reference: ${outputRefId}] - Use this ID to reference the raw output in subsequent tool calls.`;

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

              // Track tool failure
              const toolDuration = Date.now() - toolStartTime;
              const errorMessage = formatAndReportError(toolError, "mcp_tool_execution", {
                toolName: toolCall.toolName,
                serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                durationMs: toolDuration,
              });

              telemetryService.trackEvent({
                name: "MCPToolCall",
                properties: {
                  toolName: toolCall.toolName,
                  status: "failed",
                  serverName: toolCall.toolName.split("__")[0] ?? "unknown",
                  durationMs: toolDuration.toString(),
                  error: errorMessage,
                },
                measurements: {
                  duration: toolDuration,
                },
              });

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

  public cancelAllPendingApprovals(reason = "Session cancelled"): void {
    UserInteractionService.getInstance().cancelAllPending(reason);
  }

  private appendVideoInfoToSystemPrompt(
    systemPrompt: string,
    videoUploadResult?: VideoUploadResult,
    videoFilePath?: string,
  ): string {
    const videoUrl = videoUploadResult?.data?.url;
    const duration = videoUploadResult?.data?.duration;
    if (videoUrl) {
      const isValidDuration = typeof duration === "number" && duration > 0;

      if (isValidDuration) {
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
Embed this URL in the task content that you create. Follow user requirements STRICTLY about the link formatting rule.`;
      }
    }

    // If a video file path is provided, add it to the system prompt for screenshot capture
    if (videoFilePath) {
      systemPrompt += `\n\nVideo file available for screenshot capture: ${videoFilePath}.`;
    }

    return systemPrompt;
  }
}
