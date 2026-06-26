import { ProgressStage, type WorkflowState, type WorkflowStep } from "@shared/types/workflow";

/**
 * #821: the per-stage live progress (WorkflowState) is NOT persisted — only the final
 * shave row (status, finalOutput, errorMessage) is. So when the Workflow Progress page is
 * reached by navigation (`/workflow/:shaveId`) rather than from a live run, we reconstruct a
 * best-effort WorkflowState from the persisted shave status, so the familiar stage view still
 * renders. For a Completed shave this is exact (every stage ran to completion); for other
 * statuses we don't know which stage was reached, so we render a neutral "not started" view and
 * surface the error/result separately (see ShaveOutcomeView).
 */
const STAGES: ProgressStage[] = [
  ProgressStage.UPLOADING_VIDEO,
  ProgressStage.DOWNLOADING_VIDEO,
  ProgressStage.CONVERTING_AUDIO,
  ProgressStage.TRANSCRIBING,
  ProgressStage.ANALYZING_TRANSCRIPT,
  ProgressStage.SELECTING_PROMPT,
  ProgressStage.EXECUTING_TASK,
  ProgressStage.UPDATING_METADATA,
];

function buildState(status: WorkflowStep["status"]): WorkflowState {
  const step = (stage: ProgressStage): WorkflowStep => ({ stage, status });
  return {
    uploading_video: step(ProgressStage.UPLOADING_VIDEO),
    downloading_video: step(ProgressStage.DOWNLOADING_VIDEO),
    converting_audio: step(ProgressStage.CONVERTING_AUDIO),
    transcribing: step(ProgressStage.TRANSCRIBING),
    analyzing_transcript: step(ProgressStage.ANALYZING_TRANSCRIPT),
    selecting_prompt: step(ProgressStage.SELECTING_PROMPT),
    executing_task: step(ProgressStage.EXECUTING_TASK),
    updating_metadata: step(ProgressStage.UPDATING_METADATA),
  };
}

/**
 * Reconstruct the stage view for a persisted shave. Returns `null` for statuses where we cannot
 * honestly assert per-stage progress (Failed/Cancelled/Pending/Unknown) — the caller shows the
 * status + error instead of a misleading per-stage picture.
 */
export function reconstructWorkflowState(shaveStatus: string): WorkflowState | null {
  if (shaveStatus === "Completed") {
    return buildState("completed");
  }
  return null;
}

export { STAGES as WORKFLOW_STAGES };
