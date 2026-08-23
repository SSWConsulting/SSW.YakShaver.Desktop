import { randomUUID } from "node:crypto";
import type { ModelMessage, ToolExecutionOptions, ToolModelMessage, UserModelMessage } from "ai";
import type { ZodType } from "zod";
import { VIDEO_LINK_EMBEDDING_RULES } from "../../constants/prompts";
import { getDurationParts } from "../../utils/duration-utils";
import { formatAndReportError } from "../../utils/error-utils";
import {
  isBacklogItemMutationTool,
  normalizeIssueScreenshots,
} from "../../utils/screenshot-markdown";
import type { VideoUploadResult } from "../auth/types";
import { TelemetryService } from "../telemetry/telemetry-service";
import { UserInteractionService } from "../user-interaction/user-interaction-service";
import {
  type BacklogArtifact,
  type IBacklogOrchestrator,
  judgeBacklogOutcome,
  type ManualLoopOptions,
  type MCPLoopResult,
  type MCPTerminationReason,
  type ToolActivity,
} from "./backlog-orchestrator";
import { LanguageModelProvider } from "./language-model-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { orchestratorSystemPrompt } from "./prompts";

// Re-export the shared backlog-orchestrator contract from here so existing importers
// (and tests) that reference these symbols on the orchestrator module keep working.
export {
  type BacklogArtifact,
  BacklogOutcomeSchema,
  type IBacklogOrchestrator,
  type MCPLoopResult,
  type MCPTerminationReason,
} from "./backlog-orchestrator";

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

export class MCPOrchestrator implements IBacklogOrchestrator {
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

  /**
   * #834 — Deterministic guard applied to backlog create/update tool arguments before execution.
   * The issue/work-item body markdown is authored freely by the LLM, which intermittently embeds
   * the same screenshot twice (top of body + "### Screenshots" section) and omits the bold
   * `**Figure: ...**` caption. We normalise the body-bearing string fields here so the rendered
   * issue always has exactly one captioned screenshot, regardless of model phrasing.
   */
  private normalizeScreenshotMarkdownInArgs(
    toolName: string,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    // Only touch tools that create/update a backlog item (issue / work item / PBI / ticket).
    // Decided by an anchored allow-list that explicitly excludes comment/reply/cache/read-only
    // tools (e.g. `add_issue_comment`, `update_issue_cache`) — see isBacklogItemMutationTool.
    if (!isBacklogItemMutationTool(toolName)) {
      return input;
    }

    // Body-like fields used across GitHub / Azure DevOps / Jira MCP servers.
    const bodyFieldNames = new Set(["body", "description", "content", "markdown", "text"]);
    let changed = false;
    const resolved: Record<string, unknown> = { ...input };
    for (const [key, value] of Object.entries(input)) {
      if (bodyFieldNames.has(key.toLowerCase()) && typeof value === "string") {
        const normalized = normalizeIssueScreenshots(value);
        if (normalized !== value) {
          resolved[key] = normalized;
          changed = true;
        }
      }
    }
    if (changed) {
      console.log(`[MCPOrchestrator] Normalized screenshot markdown for tool '${toolName}' (#834)`);
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
    videoTranscription: string,
    videoUploadResult?: VideoUploadResult,
    options: ManualLoopOptions = {},
  ): Promise<MCPLoopResult> {
    // Ensure LLM has been initialized
    if (!MCPOrchestrator.languageModelProvider) {
      throw new Error("[MCPOrchestrator]: LLM client not initialized");
    }

    console.log("[MCPOrchestrator] Starting manual loop with prompt strings");

    // Ensure MCP server manager is initialized
    const serverManager = MCPOrchestrator.mcpServerManager;
    if (!serverManager) {
      throw new Error("[MCPOrchestrator]: MCP server manager not initialized");
    }

    // Get tools and apply the server filter if provided
    const tools = await serverManager.collectToolsWithServerPrefixAsync();

    let systemPrompt = orchestratorSystemPrompt;

    systemPrompt += options.projectMetaData
      ? `\n---\nProject Metadata:\n${options.projectMetaData}`
      : "";

    systemPrompt += options.desktopAgentProjectPrompt
      ? `\n---\nProject Prompt:\n${options.desktopAgentProjectPrompt}`
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
      { role: "user", content: `video transcription: ${videoTranscription}` },
    ];

    // Records every executed tool call + its result. At the end we judge — from these
    // RESULTS, not the model's narration — whether a backlog item was actually filed (#833).
    const toolActivity: ToolActivity[] = [];

    // Every loop exit funnels through here so the outcome is judged from the tool RESULTS
    // regardless of WHY the loop ended — an item filed before a cap/limit is still honoured.
    const finalize = async (
      text: string,
      terminationReason: MCPTerminationReason,
      judgeFinalText: string,
    ): Promise<MCPLoopResult> => {
      const outcome = await this.judgeBacklogOutcome(
        options.desktopAgentProjectPrompt,
        videoTranscription,
        toolActivity,
        judgeFinalText,
      );
      return {
        text,
        backlogActionSucceeded: outcome.achieved,
        artifacts: outcome.artifacts,
        terminationReason,
      };
    };

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
        const toolWhiteList = new Set(
          (await MCPOrchestrator.mcpServerManager?.getWhitelistWithServerPrefixAsync()) ?? [],
        );
        for (const toolCall of llmResponse.toolCalls) {
          const isWhitelisted = toolWhiteList.has(toolCall.toolName);
          const toolStartTime = Date.now();

          if (!isWhitelisted) {
            const requestId = randomUUID();

            const decision = await UserInteractionService.getInstance().requestToolApproval(
              toolCall.toolName,
              toolCall.input,
              {
                message: `Approval required to run ${toolCall.toolName}`,
                shaveId: options.shaveId,
              },
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
              return finalize("Tool execution cancelled by user", "cancelled", "");
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
              const resolvedInput = this.normalizeScreenshotMarkdownInArgs(
                toolCall.toolName,
                this.resolveToolOutputReferences(toolCall.input),
              );

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

              // Record the call + its result for the end-of-loop outcome judge. `ok` reflects
              // whether the tool itself errored (MCP sets isError on a failed/auth-denied call).
              const toolErrored = (toolOutput as { isError?: boolean }).isError === true;
              toolActivity.push({
                toolName: toolCall.toolName,
                ok: !toolErrored,
                // Keep enough of the result that a created-item id/URL near the end is still
                // visible to the outcome judge (a verbose tool body shouldn't hide the artifact).
                resultText: rawOutputText.slice(0, 8000),
              });

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
        // Clean finish: judge from the tool RESULTS whether a backlog item was actually filed.
        return finalize(llmResponse.text, "stop", llmResponse.text);
      } else if (llmResponse.finishReason === "content-filter") {
        console.log("[MCPOrchestrator] Session ended: Content filter triggered");
        ToolOutputBuffer.getInstance().clear();
        return finalize(
          "Conversation ended due to content filter.",
          "content-filter",
          llmResponse.text,
        );
      } else if (llmResponse.finishReason === "length") {
        console.log("[MCPOrchestrator] Session ended: Maximum length reached");
        ToolOutputBuffer.getInstance().clear();
        return finalize("Conversation ended due to length limit.", "length", llmResponse.text);
      } else {
        console.log("[MCPOrchestrator] Session ended with unknown reason:");
        console.log(llmResponse.finishReason);
        ToolOutputBuffer.getInstance().clear();
        return finalize("", "unknown", llmResponse.text);
      }
    }

    // The loop exhausted its iteration cap. An item may already have been filed before the cap,
    // so judge from the tool results rather than assuming failure.
    ToolOutputBuffer.getInstance().clear();
    return finalize("", "max-iterations", "");
  }

  /**
   * Decides whether the run ACTUALLY created/updated a backlog item (#833). Delegates to the
   * shared `judgeBacklogOutcome`, which is also used by the local Claude Code backend so success
   * is judged identically regardless of who drove the tools.
   */
  private async judgeBacklogOutcome(
    goal: string | undefined,
    transcript: string,
    toolActivity: ToolActivity[],
    finalText: string,
  ): Promise<{ achieved: boolean; artifacts: BacklogArtifact[] }> {
    return judgeBacklogOutcome(
      MCPOrchestrator.languageModelProvider,
      goal,
      transcript,
      toolActivity,
      finalText,
    );
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
      const videoEmbeddingRules = systemPrompt.includes(VIDEO_LINK_EMBEDDING_RULES)
        ? ""
        : `\n${VIDEO_LINK_EMBEDDING_RULES}`;

      if (isValidDuration) {
        const outputDuration = getDurationParts(duration);
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Video duration:
- totalSeconds: ${outputDuration.totalSeconds}
- hours: ${outputDuration.hours}
- minutes: ${outputDuration.minutes}
- seconds: ${outputDuration.seconds}
${videoEmbeddingRules}`;
      } else {
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
${videoEmbeddingRules}`;
      }
    }

    // If a video file path is provided, add it to the system prompt for screenshot capture
    if (videoFilePath) {
      systemPrompt += `\n\nVideo file available for screenshot capture: ${videoFilePath}.`;
    }

    return systemPrompt;
  }
}
