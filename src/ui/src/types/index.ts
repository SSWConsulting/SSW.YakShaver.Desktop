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
    duration: number;
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

export interface CustomPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  isTemplate?: boolean;
  selectedMcpServerIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PromptFormData {
  name: string;
  description?: string;
  content: string;
  selectedMcpServerIds?: string[];
}

export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
  isChecking: boolean;
}

export const UNDO_EVENT_CHANNEL = "yakshaver:undo-event";

export type UndoEventDetail = {
  type: "start" | "complete" | "error" | "reset";
};

export enum MCPStepType {
  START = "start",
  REASONING = "reasoning",
  TOOL_CALL = "tool_call",
  TOOL_RESULT = "tool_result",
  FINAL_RESULT = "final_result",
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
  Cancelled = "Cancelled",
  Failed = "Failed",
}

export type Shave = {
  id: string;
  clientOrigin: string | null;
  title: string;
  shaveStatus: ShaveStatus;
  projectName: string | null;
  workItemUrl: string | null;
  videoEmbedUrl: string | null;
  portalWorkItemId: string | null;
  createdAt: string;
  updatedAt: string | null;
  // #821: persisted outcome detail returned by getShaveById (used to rehydrate the Workflow
  // Progress page when reached by navigation rather than from a live run). Absent on list rows.
  finalOutput?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
};

export type VersionInfo = {
  version: string;
  commitHash: string;
};

export type BadgeVariant = "success" | "destructive" | "secondary" | "default";
