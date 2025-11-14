export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
  disabled?: boolean;
}

export enum ProgressStage {
  IDLE = "idle",
  UPLOAD_COMPLETED = "upload_completed",
  CONVERTING_AUDIO = "converting_audio",
  TRANSCRIBING = "transcribing",
  TRANSCRIPTION_COMPLETED = "transcription_completed",
  GENERATING_TASK = "generating_task",
  EXECUTING_TASK = "executing_task",
  ERROR = "error",
  COMPLETED = "completed",
}
