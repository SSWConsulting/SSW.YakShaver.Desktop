import { z } from "zod";
import type { MCPStep } from "../../../shared/types/mcp";
import type { VideoUploadResult } from "../auth/types";

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
  /**
   * True when a tool call succeeded but the outcome could NOT be verified because no judge model
   * was configured (the local-Claude-without-an-OpenAI/Azure-model case). The run still counts as
   * not-succeeded (we fail closed), but the caller should tell the user an item MAY have been
   * created and to check their backlog before re-running — not that their connection is signed out.
   */
  verificationUnavailable?: boolean;
}

/** One executed tool call and (a truncated view of) its result — the ground truth the judge reasons over. */
export interface ToolActivity {
  toolName: string;
  ok: boolean;
  resultText: string;
}

/**
 * Options the backlog-creation step passes to whichever orchestrator backend drives it.
 * Identical to what `MCPOrchestrator.manualLoopAsync` accepts so the call site is backend-agnostic.
 */
export interface ManualLoopOptions {
  projectMetaData?: string;
  desktopAgentProjectPrompt?: string;
  maxToolIterations?: number; // safety cap to avoid infinite loops
  videoFilePath?: string; // local video file path for screenshot capture
  serverFilter?: string[]; // if provided, only include tools from these server IDs
  shaveId?: string; // identifies the current shave for per-shave auto-approve
  onStep?: (step: MCPStep) => void;
  /**
   * Aborts an in-flight run. The OpenAI backend can already be cancelled via its approval flow;
   * the headless local-Claude backend has no approval prompts, so this signal is its cancellation
   * path — when it fires the spawned `claude -p` child is killed and the run rejects.
   */
  signal?: AbortSignal;
}

/**
 * The seam the EXECUTING_TASK stage talks to. Both the in-process `MCPOrchestrator` (OpenAI loop)
 * and the `LocalClaudeOrchestrator` (headless `claude -p`) implement this, so the call site can
 * pick a backend without caring how the work gets done — both return the same `MCPLoopResult`,
 * whose `backlogActionSucceeded` gates COMPLETE vs FAIL.
 */
export interface IBacklogOrchestrator {
  manualLoopAsync(
    videoTranscription: string,
    videoUploadResult?: VideoUploadResult,
    options?: ManualLoopOptions,
  ): Promise<MCPLoopResult>;
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

/** The minimal LLM capability the outcome judge needs — kept narrow so it's trivial to stub in tests. */
export interface OutcomeJudgeProvider {
  generateObject(
    prompt: string,
    schema: typeof BacklogOutcomeSchema,
    systemPrompt?: string,
  ): Promise<{ achieved: boolean; artifacts: BacklogArtifact[]; reasoning?: string }>;
}

/**
 * Decides whether the run ACTUALLY created/updated a backlog item, judging from the tool
 * RESULTS (ground truth) rather than a tool-name heuristic or the model's own claims (#833).
 *
 * Shared by both orchestrator backends (OpenAI loop + local Claude Code) so success is judged
 * identically regardless of who drove the tools.
 *
 * Short-circuits to "not achieved" when no tool call succeeded (the common signed-out case),
 * so the extra LLM call only happens when something plausibly did get filed. Fails CLOSED
 * (not achieved) if the judge is unavailable or errors — a false success is the costly mistake.
 */
export async function judgeBacklogOutcome(
  provider: OutcomeJudgeProvider | null | undefined,
  goal: string | undefined,
  transcript: string,
  toolActivity: ToolActivity[],
  finalText: string,
): Promise<{ achieved: boolean; artifacts: BacklogArtifact[]; verificationUnavailable?: boolean }> {
  const succeeded = toolActivity.filter((t) => t.ok);
  if (succeeded.length === 0) {
    console.log("[judgeBacklogOutcome] no successful tool calls -> not achieved");
    return { achieved: false, artifacts: [] };
  }

  if (!provider) {
    // A tool DID succeed, but there's no judge to confirm whether it filed a backlog item. We
    // still fail CLOSED (achieved=false), but flag verificationUnavailable so the caller can tell
    // the user "an item may have been created but couldn't be verified" instead of the misleading
    // generic "your backlog connection is signed out" copy (#833 / local-Claude no-LLM case).
    console.warn(
      "[judgeBacklogOutcome] outcome judge unavailable (no LLM) but a tool succeeded -> " +
        "not achieved, verification unavailable",
    );
    return { achieved: false, artifacts: [], verificationUnavailable: true };
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
    // artifacts — or only blank `idOrUrl`s (the schema allows empty strings) — is treated as
    // not-achieved (conservative — a false success is the costly error).
    const achieved = verdict.achieved && verdict.artifacts.some((a) => a.idOrUrl.trim().length > 0);
    console.log("[judgeBacklogOutcome] outcome judged:", {
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
      "[judgeBacklogOutcome] outcome judge failed -> not achieved (failing closed)",
      error,
    );
    return { achieved: false, artifacts: [] };
  }
}
