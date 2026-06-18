export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
  isChecking: boolean;
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
  /** ISO string date */
  createdAt: string;
  /** Duration in seconds */
  duration: number;
}

export enum ShaveStatus {
  Unknown = "Unknown",
  Pending = "Pending",
  Processing = "Processing",
  Completed = "Completed",
  Cancelled = "Cancelled",
  Failed = "Failed",
}

export enum ShaveAttemptStatus {
  RUNNING = "running",
  COMPLETED = "completed",
  ERROR = "error",
}

export enum ShaveAttemptRunType {
  INITIAL = "initial",
  RETRY = "retry",
}

export enum PortalSyncStatus {
  PENDING = "PENDING",
  SYNCED = "SYNCED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export enum AuthProvider {
  MICROSOFT = "microsoft",
  GOOGLE = "google",
}

export enum ModelProvider {
  OPENAI = "openai",
  AZURE_OPENAI = "azure_openai",
  DEEPSEEK = "deepseek",
}

export enum VideoHostingProvider {
  YOUTUBE = "youtube",
}

export enum VideoSourceType {
  LOCAL_RECORDING = "local_recording",
  EXTERNAL_URL = "external_url",
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

/**
 * A project (tenant/organisation) the signed-in user is a member of (#816).
 * NOTE: the backend "list my projects" contract is not yet confirmed — the field
 * mapping in the portal handler is a best guess and may need adjusting once the
 * real endpoint/shape is pinned (see PR notes for #816).
 */
export interface Project {
  id: string;
  name: string;
  role?: string | null;
}

export interface GetMyProjectsResponse {
  items: Project[];
}
