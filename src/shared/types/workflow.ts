export enum ProgressStage {
  UPLOADING_VIDEO = "uploading_video",
  DOWNLOADING_VIDEO = "downloading_video",
  CONVERTING_AUDIO = "converting_audio",
  TRANSCRIBING = "transcribing",
  ANALYZING_TRANSCRIPT = "analyzing_transcript",
  SELECTING_PROMPT = "selecting_prompt",
  EXECUTING_TASK = "executing_task",
  UPDATING_METADATA = "updating_metadata",
}

export type WorkflowStatus = "not_started" | "in_progress" | "completed" | "failed" | "skipped";

export type VideoUploadOrigin = "upload" | "external";

export interface WorkflowStep {
  stage: ProgressStage;
  payload?: string; // serialized Workflow step payload
  createdAt?: number;

  status: WorkflowStatus;
}

/**
 * Canonical ordering of all workflow stages.
 * Import this instead of duplicating the list in each file.
 */
export const WORKFLOW_STAGE_ORDER: (keyof WorkflowState)[] = [
  ProgressStage.UPLOADING_VIDEO,
  ProgressStage.DOWNLOADING_VIDEO,
  ProgressStage.CONVERTING_AUDIO,
  ProgressStage.TRANSCRIBING,
  ProgressStage.ANALYZING_TRANSCRIPT,
  ProgressStage.SELECTING_PROMPT,
  ProgressStage.EXECUTING_TASK,
  ProgressStage.UPDATING_METADATA,
];

// DTO to hold all the workflow states
export interface WorkflowState {
  uploading_video: WorkflowStep;
  downloading_video: WorkflowStep;
  converting_audio: WorkflowStep;
  transcribing: WorkflowStep;
  analyzing_transcript: WorkflowStep;
  selecting_prompt: WorkflowStep;
  executing_task: WorkflowStep;
  updating_metadata: WorkflowStep;
}
