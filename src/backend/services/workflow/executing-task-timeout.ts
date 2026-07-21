import { withTimeout } from "../../utils/async-utils";
import type { VideoUploadResult } from "../auth/types";
import type {
  IBacklogOrchestrator,
  ManualLoopOptions,
  MCPLoopResult,
} from "../mcp/backlog-orchestrator";

/**
 * Runs the Executing Task loop with a wall-clock timeout (#698). Neither orchestrator backend
 * guarantees it returns in bounded time on its own: the in-process OpenAI/Azure loop
 * (`MCPOrchestrator`) has only a 20-iteration safety cap and does not read `options.signal` at
 * all, so a single stuck LLM/tool round-trip (e.g. repeatedly retrying a tool or resource that
 * doesn't exist) can hang indefinitely with no error and no way to retry. Racing the call against
 * a timer here guarantees the EXECUTING_TASK stage always settles — the timeout fails the stage
 * with a clear `terminationReason: "timeout"` instead of leaving the UI spinning for 30+ minutes.
 *
 * On timeout we also fire `signal`, which `LocalClaudeOrchestrator` already honours (killing the
 * spawned child); `MCPOrchestrator` ignores it, so its underlying HTTP call may keep running
 * detached in the background — the same accepted tradeoff `LocalClaudeOrchestrator`'s own
 * internal timeout makes, since abandoning a hung call is strictly better than never surfacing an
 * error at all.
 *
 * Extracted as a standalone function (rather than a private method) so the timeout/race behaviour
 * is unit-testable without standing up `ProcessVideoIPCHandlers` and its Electron dependencies.
 */
export async function runManualLoopWithTimeout(
  orchestrator: IBacklogOrchestrator,
  videoTranscription: string,
  videoUploadResult: VideoUploadResult | undefined,
  options: ManualLoopOptions | undefined,
  timeoutMs: number,
): Promise<MCPLoopResult> {
  const controller = new AbortController();

  try {
    return await withTimeout(
      orchestrator.manualLoopAsync(videoTranscription, videoUploadResult, {
        ...options,
        signal: controller.signal,
      }),
      timeoutMs,
      "Executing Task",
    );
  } catch (error) {
    if (!(error instanceof Error) || !/^Timeout waiting for/.test(error.message)) {
      throw error;
    }
    // Signal cancellation to whichever backend is honouring it (LocalClaudeOrchestrator kills its
    // spawned child; MCPOrchestrator currently ignores the signal — see the doc comment above for
    // why that's accepted).
    controller.abort();
    const timeoutSeconds = Math.round(timeoutMs / 1000);
    console.warn(
      `[ProcessVideo] Executing Task timed out after ${timeoutSeconds}s — failing the stage.`,
    );
    return {
      text: "",
      backlogActionSucceeded: false,
      artifacts: [],
      terminationReason: "timeout",
    } satisfies MCPLoopResult;
  }
}
