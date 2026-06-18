import { randomUUID } from "node:crypto";
import type { ModelMessage, ToolExecutionOptions, ToolModelMessage, UserModelMessage } from "ai";
import { type ZodType, z } from "zod";
import type { MCPStep } from "../../../shared/types/mcp";
import { getDurationParts } from "../../utils/duration-utils";
import { formatAndReportError } from "../../utils/error-utils";
import type { VideoUploadResult } from "../auth/types";
import { TelemetryService } from "../telemetry/telemetry-service";
import { UserInteractionService } from "../user-interaction/user-interaction-service";
import { LanguageModelProvider } from "./language-model-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { orchestratorSystemPrompt } from "./prompts";

export type MCPTerminationReason =
  | "stop"
  | "length"
  | "content-filter"
  | "cancelled"
  | "max-iterations"
  | "unknown";

export interface BacklogArtifact {
  /** e.g. "issue", "work_item", "ticket", "comment", "pull_request". */
  type: string;
  /** The concrete identifier or URL evidencing the created/updated item. */
  idOrUrl: string;
}

export interface MCPLoopResult {
  /** The model's final text output — the drafted work item, or a message explaining why it stopped. */
  text: string;
  /**
   * True only when a backlog item was actually created/updated, decided from the TOOL RESULTS
   * (not the model's narration). A graceful `stop` with only internal tools, no tools, or an
   * errored mutation means nothing was filed.
   */
  backlogActionSucceeded: boolean;
  /** The concrete created/updated artifacts the judge found (issue ids/URLs), if any. */
  artifacts: BacklogArtifact[];
  /** Why the loop ended — distinguishes a clean finish from hitting a safety cap. */
  terminationReason: MCPTerminationReason;
}

/** One executed tool call and (a truncated view of) its result — the ground truth the judge reasons over. */
interface ToolActivity {
  toolName: string;
  ok: boolean;
  resultText: string;
}

/**
 * Structured verdict from the outcome judge. Every field is REQUIRED — no `.optional()` / `.default()`.
 * OpenAI strict structured outputs reject a schema whose `required` omits any property, so a
 * `.default()` here makes the field optional and breaks the real `generateObject` call at runtime
 * ("Invalid schema for response_format … Missing 'artifacts'"). That only surfaces against a live
 * model, never in tests that stub generateObject — so keep this schema strict-compatible.
 */
export const BacklogOutcomeSchema = z.object({
  achieved: z.boolean(),
  artifacts: z.array(z.object({ type: z.string(), idOrUrl: z.string() })),
  reasoning: z.string(),
});

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
    videoTranscription: string,
    videoUploadResult?: VideoUploadResult,
    options: {
      projectMetaData?: string;
      desktopAgentProjectPrompt?: string;
      maxToolIterations?: number; // safety cap to avoid infinite loops
      videoFilePath?: string; // local video file path for screenshot capture
      serverFilter?: string[]; // if provided, only include tools from these server IDs
      shaveId?: string; // identifies the current shave for per-shave auto-approve
      onStep?: (step: MCPStep) => void;
    } = {},
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
   * Decides whether the run ACTUALLY created/updated a backlog item, judging from the tool
   * RESULTS (ground truth) rather than a tool-name heuristic or the model's own claims (#833).
   *
   * Short-circuits to "not achieved" when no tool call succeeded (the common signed-out case),
   * so the extra LLM call only happens when something plausibly did get filed. Fails CLOSED
   * (not achieved) if the judge is unavailable or errors — a false success is the costly mistake.
   */
  private async judgeBacklogOutcome(
    goal: string | undefined,
    transcript: string,
    toolActivity: ToolActivity[],
    finalText: string,
  ): Promise<{ achieved: boolean; artifacts: BacklogArtifact[] }> {
    const succeeded = toolActivity.filter((t) => t.ok);
    if (succeeded.length === 0) {
      console.log("[MCPOrchestrator] outcome: no successful tool calls -> not achieved");
      return { achieved: false, artifacts: [] };
    }

    const provider = MCPOrchestrator.languageModelProvider;
    if (!provider) {
      console.warn("[MCPOrchestrator] outcome judge unavailable (no LLM) -> not achieved");
      return { achieved: false, artifacts: [] };
    }

    const judgeSystemPrompt =
      "You are a strict verifier deciding whether an automated agent ACTUALLY created or updated " +
      "a backlog work item (e.g. a GitHub issue, an Azure DevOps work item, or a Jira ticket) as " +
      "instructed. Judge ONLY from the tool results below (ground truth) — NEVER trust the agent's " +
      "own final message, which may claim success it did not achieve. Set achieved=true only when a " +
      "non-errored tool result contains concrete evidence of a created or updated item: an id, a " +
      "number, or a URL. Put that evidence in artifacts. If no mutating tool produced such evidence — " +
      "nothing ran, the call errored, or only read/internal tools ran — set achieved=false. When " +
      "uncertain, set achieved=false.";

    const judgePrompt = [
      `TASK INSTRUCTIONS GIVEN TO THE AGENT:\n${goal?.slice(0, 4000) || "(create a backlog work item describing the user's request)"}`,
      `USER REQUEST (video transcript):\n${transcript.slice(0, 2000)}`,
      `TOOL CALLS AND THEIR RESULTS (ground truth — decide from these):\n${JSON.stringify(toolActivity)}`,
      `AGENT FINAL MESSAGE (do NOT trust this for success):\n${finalText.slice(0, 2000)}`,
    ].join("\n\n---\n\n");

    try {
      const verdict = await provider.generateObject(
        judgePrompt,
        BacklogOutcomeSchema,
        judgeSystemPrompt,
      );
      // Enforce the contract in CODE, not just the prompt: a verdict is only trusted as success
      // if it cites concrete evidence. A model that answers achieved=true but populates no
      // artifacts is treated as not-achieved (conservative — a false success is the costly error).
      const achieved = verdict.achieved && verdict.artifacts.length > 0;
      console.log("[MCPOrchestrator] outcome judged:", {
        achieved,
        modelClaimedAchieved: verdict.achieved,
        artifacts: verdict.artifacts,
        tools: toolActivity.map((t) => `${t.toolName}${t.ok ? "" : "(errored)"}`),
      });
      return { achieved, artifacts: verdict.artifacts };
    } catch (error) {
      // Fail CLOSED: if the judge itself errors we cannot confirm a filing, so report
      // not-achieved rather than risk a false success (the costly direction for #833).
      console.warn(
        "[MCPOrchestrator] outcome judge failed -> not achieved (failing closed)",
        error,
      );
      return { achieved: false, artifacts: [] };
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
