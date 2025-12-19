export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
}

export enum ProgressStage {
  IDLE = "idle",
  UPLOADING_SOURCE = "uploading_source",
  DOWNLOADING_SOURCE = "downloading_source",
  UPLOAD_COMPLETED = "upload_completed",
  CONVERTING_AUDIO = "converting_audio",
  TRANSCRIBING = "transcribing",
  TRANSCRIPTION_COMPLETED = "transcription_completed",
  GENERATING_TASK = "generating_task",
  EXECUTING_TASK = "executing_task",
  UPDATING_METADATA = "updating_metadata",
  ERROR = "error",
  COMPLETED = "completed",
}

export interface VideoFile {
  fileName: string;
  createdAt: string;
  duration: string;
  isChromeExtension: boolean;
}

export interface VideoFileMetadata {
  fileName: string;
  filePath?: string;
  createdAt: string; // ISO string date
  duration: number; // in seconds
}

export enum ShaveStatus {
  Pending = "Pending",
  Processing = "Processing",
  Completed = "Completed",
  Failed = "Failed",
}

export interface ShaveItem {
  id: string;
  title: string;
  videoFile: VideoFile;
  updatedAt: string;
  createdAt: string;
  shaveStatus: string;
  workItemType: string;
  projectName: string;
  workItemUrl: string;
  feedback: string | null;
  videoEmbedUrl: string;
}

export interface GetMyShavesResponse {
  items: ShaveItem[];
}
