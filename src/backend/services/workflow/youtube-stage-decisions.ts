import {
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
  type WorkflowStatus,
} from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../auth/types";

/**
 * The minimal slice of the workflow state manager that the stage-routing helpers
 * below need. `WorkflowStateManager` satisfies this structurally — depending on the
 * interface (rather than the concrete class) keeps this module free of the heavy IPC
 * imports and lets the routing be unit-tested with a tiny fake sink.
 */
export interface StageSink {
  completeStage(stage: keyof WorkflowState, payload?: unknown): void;
  failStage(stage: keyof WorkflowState, error: string | Error): void;
  skipStage(stage: keyof WorkflowState): void;
}

/**
 * #672: only complete the "Uploading Video" stage when the upload actually
 * succeeded. `uploadVideo()` returns `{ success: false }` (without throwing) when
 * e.g. the Google account has no YouTube channel — previously that still completed
 * the stage, leaving a green tick and no link. Anything that isn't a clear success
 * must fail the stage so the user sees why.
 */
export function uploadSucceeded(result: VideoUploadResult): boolean {
  return result.success === true;
}

/**
 * #672: the message to show when the upload stage fails. Prefer the concrete error
 * surfaced by the client (e.g. the no-channel copy from describeYouTubeUploadError),
 * falling back to a generic message so the stage never fails silently.
 */
export function resolveUploadFailureMessage(result: VideoUploadResult): string {
  return result.error || "Video upload failed";
}

/**
 * #798: the "Updating Metadata" stage only applies to a video we uploaded and own.
 * Returns the YouTube videoId whose metadata should be updated, or `null` when the
 * stage should be skipped — for an external link (a YouTube URL the user may not
 * own) or a failed/absent upload (no videoId). Returning the id (rather than a
 * boolean) lets the caller use it without re-deriving or re-narrowing.
 */
export function metadataVideoIdToUpdate(result: VideoUploadResult): string | null {
  const videoId = result.data?.videoId;
  if (result.origin === "external" || result.success !== true || !videoId) {
    return null;
  }
  return videoId;
}

/**
 * #672: route the "Uploading Video" stage based on whether the upload actually
 * succeeded — complete it (green tick + link) on success, fail it (so the user sees
 * why) otherwise. Extracted from the IPC handler so this wiring is unit-testable: a
 * future edit can't silently invert the branch or swap completeStage<->failStage
 * without a test going red.
 */
export function applyUploadStageOutcome(
  result: VideoUploadResult,
  filePath: string,
  sink: StageSink,
): void {
  if (uploadSucceeded(result)) {
    sink.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, {
      filePath,
      sourceOrigin: result.origin,
      uploadResult: result,
    });
  } else {
    sink.failStage(WorkflowProgressStage.UPLOADING_VIDEO, resolveUploadFailureMessage(result));
  }
}

/**
 * #798: decide the "Updating Metadata" stage. Returns the videoId whose metadata the
 * caller should update, or `null` when the stage does not apply (external link, or a
 * failed/absent upload) — in which case it skips the stage on the sink as a side
 * effect. Extracted so the skip-vs-update routing is unit-testable.
 */
export function resolveMetadataStage(result: VideoUploadResult, sink: StageSink): string | null {
  const videoId = metadataVideoIdToUpdate(result);
  if (!videoId) {
    sink.skipStage(WorkflowProgressStage.UPDATING_METADATA);
    return null;
  }
  return videoId;
}

/**
 * #306: whether the outer `processVideoSource` catch-all should mark `currentStage` as
 * failed for an exception that escaped every stage's own local try/catch.
 *
 * `currentStage` tracks "the stage this function was last working on", but a stage can
 * have already reached a genuinely terminal, non-error status ("completed" or "skipped")
 * by the time an unrelated LATER exception (e.g. a network blip in a best-effort,
 * non-fatal step that runs after the stage finished) bubbles up to the outer catch. Only
 * a stage still "in_progress" (actively being worked on) or "not_started" (never even
 * reached its own startStage/updateStagePayload call) represents the stage that was
 * genuinely interrupted by the error — re-failing it is correct. Re-failing a stage that
 * already reported "completed" or "skipped" would silently erase a real success (e.g. a
 * work item that was genuinely created) and — since the UI's isWorkflowReadyForFinalOutput
 * requires `executing_task` to stay "completed" — permanently hide the Final Result panel
 * for a run that actually succeeded.
 */
export function shouldFailStageOnUnexpectedError(currentStatus: WorkflowStatus): boolean {
  return currentStatus === "in_progress" || currentStatus === "not_started";
}
