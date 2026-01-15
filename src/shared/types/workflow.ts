export enum ProgressStage {
  UPLOADING_VIDEO = "uploading_video",
  DOWNLOADING_VIDEO = "downloading_video",
  CONVERTING_AUDIO = "converting_audio",
  TRANSCRIBING = "transcribing",
  ANALYZING_TRANSCRIPT = "analyzing_transcript",
  EXECUTING_TASK = "executing_task",
  UPDATING_METADATA = "updating_metadata",
  FINAL_STEP = "final_step",
}

export type WorkflowStatus = "not_started" | "in_progress" | "completed" | "failed";

export type VideoUploadOrigin = "upload" | "external";

export interface WorkflowStep {
  stage: ProgressStage;
  payload?: string; // serialized Workflow step payload
  createdAt?: number;

  status: WorkflowStatus;
}

// DTO to hold all the workflow states
export interface WorkflowState {
  uploading_video: WorkflowStep;
  downloading_video: WorkflowStep;
  converting_audio: WorkflowStep;
  transcribing: WorkflowStep;
  analyzing_transcript: WorkflowStep;
  executing_task: WorkflowStep;
  updating_metadata: WorkflowStep;
  final_step: WorkflowStep;
}
