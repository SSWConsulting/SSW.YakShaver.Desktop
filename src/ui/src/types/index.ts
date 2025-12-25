export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  channelName?: string;
}

export interface AuthResult {
  success: boolean;
  userInfo?: UserInfo;
  error?: string;
}

export enum AuthStatus {
  NOT_AUTHENTICATED = "not_authenticated",
  AUTHENTICATING = "authenticating",
  AUTHENTICATED = "authenticated",
  ERROR = "error",
}

export interface AuthState {
  status: AuthStatus;
  userInfo?: UserInfo;
  error?: string;
}

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
}

export type VideoUploadOrigin = "upload" | "external";

export interface VideoUploadResult {
  success: boolean;
  data?: {
    videoId: string;
    title: string;
    description: string;
    url: string;
  };
  origin?: VideoUploadOrigin;
  error?: string;
}

export enum UploadStatus {
  IDLE = "idle",
  UPLOADING = "uploading",
  SUCCESS = "success",
  ERROR = "error",
}

export interface ConvertVideoToMp3Result {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface ScreenRecordingStartResult {
  success: boolean;
  sourceId?: string;
  error?: string;
}

export interface ScreenRecordingStopResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  duration?: number;
  error?: string;
}

export interface ScreenSource {
  id: string;
  name: string;
  displayId?: string;
  appIconDataURL?: string;
  thumbnailDataURL?: string;
  type: "screen" | "window";
  isMainWindow?: boolean;
}

export interface TranscriptEntry {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: unknown[];
  name?: string;
}

interface OpenAI {
  provider: "openai";
  apiKey: string;
}

interface AzureOpenAI {
  provider: "azure";
  apiKey: string;
  endpoint: string;
  version: string;
  deployment: string;
}

export type LLMConfig = OpenAI | AzureOpenAI;

export interface VideoChapter {
  label: string;
  timestamp: string;
}

export interface MetadataPreview {
  title: string;
  description: string;
  tags?: string[];
  chapters?: VideoChapter[];
}

export type WorkflowStage =
  | "idle"
  | "uploading_source"
  | "downloading_source"
  | "converting_audio"
  | "transcribing"
  | "generating_task"
  | "executing_task"
  | "updating_metadata"
  | "completed"
  | "error";

export const STAGE_CONFIG: Record<WorkflowStage, string> = {
  idle: "Waiting for recording...",
  uploading_source: "Uploading video",
  downloading_source: "Downloading source video",
  converting_audio: "Converting audio",
  transcribing: "Transcribing audio",
  generating_task: "Analyzing transcript",
  executing_task: "Executing task",
  updating_metadata: "Updating YouTube metadata",
  completed: "Completed",
  error: "Error occurred",
};

export interface WorkflowProgress {
  stage: WorkflowStage;
  transcript?: string;
  intermediateOutput?: string;
  finalOutput?: string;
  uploadResult?: VideoUploadResult;
  metadataPreview?: MetadataPreview;
  error?: string;
  sourceOrigin?: VideoUploadOrigin;
}

export interface CustomPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
  isChecking?: boolean;
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

export const UNDO_EVENT_CHANNEL = "yakshaver:undo-event";

export type UndoEventDetail = {
  type: "start" | "complete" | "error" | "reset";
};

export type ToolApprovalMode = "yolo" | "wait" | "ask";

export interface GeneralSettings {
  toolApprovalMode: ToolApprovalMode;
}

export enum MCPStepType {
  START = "start",
  REASONING = "reasoning",
  TOOL_CALL = "tool_call",
  TOOL_RESULT = "tool_result",
  FINAL_RESULT = "final_result",
  TOOL_APPROVAL_REQUIRED = "tool_approval_required",
  TOOL_DENIED = "tool_denied",
}

export interface MCPStep {
  type: MCPStepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  requestId?: string;
  timestamp?: number;
  autoApproveAt?: number;
}

export type MicrosoftAccountInfo = {
  homeAccountId: string;
  environment: string;
  tenantId: string;
  username: string;
  localAccountId: string;
  loginHint?: string;
  name?: string;
};

export interface VideoFile {
  fileName: string;
  createdAt: string;
  duration: string;
  isChromeExtension: boolean;
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

export type VideoFileMetadata = {
  fileName: string;
  filePath?: string;
  createdAt: string;
  duration: number;
};

export enum ShaveStatus {
  Unknown = "Unknown",
  Pending = "Pending",
  Processing = "Processing",
  Completed = "Completed",
  Failed = "Failed",
}

export type Shave = {
  id: number;
  workItemSource: string;
  title: string;
  videoFile: VideoFileMetadata | null;
  shaveStatus: ShaveStatus;
  projectName: string | null;
  workItemUrl: string | null;
  videoEmbedUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type BadgeVariant = "success" | "destructive" | "secondary" | "default";
