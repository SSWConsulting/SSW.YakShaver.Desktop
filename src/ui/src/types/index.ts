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

export interface VideoUploadResult {
  success: boolean;
  data?: {
    title: string;
    description: string;
    url: string;
  };
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

export type WorkflowStage =
  | "idle"
  | "converting_audio"
  | "transcribing"
  | "generating_task"
  | "executing_task"
  | "completed"
  | "error";

export interface WorkflowProgress {
  stage: WorkflowStage;
  transcript?: string;
  intermediateOutput?: string;
  finalOutput?: string;
  uploadResult?: VideoUploadResult;
  error?: string;
}

export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
  isChecking?: boolean;
}
