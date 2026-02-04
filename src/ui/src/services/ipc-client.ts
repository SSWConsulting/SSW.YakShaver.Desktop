import type { LLMConfigV2 } from "@shared/types/llm";
import type { UserSettings } from "@shared/types/user-settings";
import type { MCPServerConfig } from "@/components/settings/mcp/McpServerForm";
import type {
  ProcessedRelease,
  ReleaseChannel,
} from "@/components/settings/release-channels/ReleaseChannelManager";
import type {
  CreateShaveData,
  CreateVideoData,
  CreateVideoSourceData,
  UpdateShaveData,
} from "../../../backend/db/schema";
import type {
  AuthResult,
  AuthState,
  ConvertVideoToMp3Result,
  CustomPrompt,
  GetMyShavesResponse,
  HealthStatusInfo,
  MCPStep,
  ScreenRecordingStartResult,
  ScreenRecordingStopResult,
  ScreenSource,
  Shave,
  ShaveStatus,
  TranscriptEntry,
  UserInfo,
  VersionInfo,
  VideoUploadResult,
} from "../types";

declare global {
  interface Window {
    electronAPI: {
      pipelines: {
        processVideoFile: (filePath: string, shaveId?: number) => Promise<void>;
        processVideoUrl: (url: string, shaveId?: number) => Promise<void>;
        retryVideo: (
          intermediateOutput: string,
          videoUploadResult: VideoUploadResult,
          shaveId?: number,
        ) => Promise<{
          success: boolean;
          finalOutput?: string | null;
          error?: string;
        }>;
      };
      youtube: {
        startAuth: () => Promise<AuthResult>;
        getAuthStatus: () => Promise<AuthState>;
        getCurrentUser: () => Promise<UserInfo | null>;
        disconnect: () => Promise<boolean>;
        refreshToken: () => Promise<boolean>;
        uploadVideo: () => Promise<VideoUploadResult>;
        uploadRecordedVideo: (filePath?: string) => Promise<VideoUploadResult>;
      };
      llm: {
        setConfig: (config: LLMConfigV2) => Promise<{ success: boolean }>;
        getConfig: () => Promise<LLMConfigV2 | null>;
        clearConfig: () => Promise<{ success: boolean }>;
        checkHealth: () => Promise<HealthStatusInfo>;
      };
      auth: {
        microsoft: {
          login: () => Promise<AuthResult>;
          logout: () => Promise<boolean>;
          status: () => Promise<AuthState>;
          accountInfo: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
        };
      };
      video: {
        selectVideoFile: () => Promise<string | null>;
        selectOutputDirectory: () => Promise<string | null>;
        convertVideoToMp3: (
          inputPath: string,
          outputPath: string,
        ) => Promise<ConvertVideoToMp3Result>;
      };
      screenRecording: {
        start: (sourceId?: string) => Promise<ScreenRecordingStartResult>;
        startTimer: () => Promise<void>;
        stop: (videoData: Uint8Array) => Promise<ScreenRecordingStopResult>;
        listSources: () => Promise<ScreenSource[]>;
        cleanupTempFile: (filePath: string) => Promise<void>;
        showControlBar: (cameraDeviceId?: string) => Promise<{ success: boolean }>;
        hideControlBar: () => Promise<{ success: boolean }>;
        stopFromControlBar: () => Promise<{ success: boolean }>;
        minimizeMainWindow: () => Promise<{ success: boolean }>;
        restoreMainWindow: () => Promise<{ success: boolean }>;
        startSystemAudio: () => Promise<{ success: boolean; error?: string; metadata?: unknown }>;
        stopSystemAudio: () => Promise<{ success: boolean }>;
        getSystemAudioStatus: () => Promise<{
          isRecording: boolean;
          permissionStatus: string;
          isAvailable: boolean;
        }>;
        onSystemAudioData: (callback: (data: { data: ArrayBuffer }) => void) => () => void;
        onSystemAudioMetadata: (callback: (metadata: unknown) => void) => () => void;
        onStopRequest: (callback: () => void) => () => void;
        onOpenSourcePicker: (callback: () => void) => () => void;
      };
      controlBar: {
        onTimeUpdate: (callback: (time: string) => void) => () => void;
      };
      workflow: {
        onProgress: (callback: (progress: unknown) => void) => () => void;
        onProgressNeo: (callback: (progress: unknown) => void) => () => void;
      };
      mcp: {
        processMessage: (
          prompt: string,
          videoUrl?: string,
          options?: { serverFilter?: string[] },
        ) => Promise<{
          final: string | null;
          transcript: TranscriptEntry[];
        }>;
        prefillPrompt: (text: string) => void;
        onPrefillPrompt: (callback: (text: string) => void) => () => void;
        onStepUpdate: (callback: (step: MCPStep) => void) => () => void;
        respondToToolApproval: (
          requestId: string,
          decision: ToolApprovalDecisionPayload,
        ) => Promise<{ success: boolean }>;
        listServers: () => Promise<MCPServerConfig[]>;
        addToolToWhitelist: (toolName: string) => Promise<{ success: boolean }>;
        addServerAsync: (
          config: MCPServerConfig,
        ) => Promise<{ success: boolean; data?: MCPServerConfig }>;
        updateServerAsync: (
          serverId: string,
          config: MCPServerConfig,
        ) => Promise<{ success: boolean }>;
        removeServerAsync: (serverId: string) => Promise<{ success: boolean }>;
        checkServerHealthAsync: (serverId: string) => Promise<HealthStatusInfo>;
        listServerTools: (
          serverId: string,
        ) => Promise<Array<{ name: string; description?: string }>>;
      };
      settings: {
        getAllPrompts: () => Promise<Array<CustomPrompt>>;
        getActivePrompt: () => Promise<CustomPrompt | null>;
        addPrompt: (prompt: {
          name: string;
          description?: string;
          content: string;
          selectedMcpServerIds?: string[];
        }) => Promise<CustomPrompt>;
        updatePrompt: (
          id: string,
          updates: {
            name?: string;
            description?: string;
            content?: string;
            selectedMcpServerIds?: string[];
          },
        ) => Promise<boolean>;
        deletePrompt: (id: string) => Promise<boolean>;
        setActivePrompt: (id: string) => Promise<boolean>;
        clearCustomPrompts: () => Promise<void>;
      };
      releaseChannel: {
        get: () => Promise<ReleaseChannel>;
        set: (channel: ReleaseChannel) => Promise<void>;
        listReleases: () => Promise<{
          releases: Array<ProcessedRelease>;
          error?: string;
        }>;
        checkUpdates: () => Promise<{
          available: boolean;
          error?: string;
          version?: string;
        }>;
        getCurrentVersion: () => Promise<VersionInfo>;
        onDownloadProgress: (
          callback: (progress: { percent: number; transferred: number; total: number }) => void,
        ) => () => void;
      };
      githubToken: {
        get: () => Promise<string | undefined>;
        set: (token: string) => Promise<void>;
        clear: () => Promise<void>;
        has: () => Promise<boolean>;
        verify: () => Promise<{
          isValid: boolean;
          username?: string;
          scopes?: string[];
          rateLimitRemaining?: number;
          error?: string;
        }>;
      };
      userSettings: {
        get: () => Promise<UserSettings>;
        update: (patch: Partial<UserSettings>) => Promise<{ success: boolean; error?: string }>;
        onHotkeyUpdate: (callback: (hotkeys: UserSettings["hotkeys"]) => void) => () => void;
      };
      app: {
        restart: () => Promise<{ success: boolean; error?: string }>;
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
        onProtocolError: (callback: (message: string) => void) => () => void;
      };
      portal: {
        getMyShaves: () => Promise<{
          success: boolean;
          data?: GetMyShavesResponse;
          error?: string;
        }>;
      };
      shave: {
        create: (
          shaveData: CreateShaveData,
          videoFile?: CreateVideoData,
          videoSource?: CreateVideoSourceData,
        ) => Promise<{ success: boolean; data?: Shave; error?: string }>;
        getById: (
          id: string,
        ) => Promise<{ success: boolean; data?: Shave | undefined; error?: string }>;
        getAll: () => Promise<{ success: boolean; data?: Shave[]; error?: string }>;
        findByVideoUrl: (
          videoEmbedUrl: string,
        ) => Promise<{ success: boolean; data?: Shave | undefined; error?: string }>;
        attachVideoSource: (
          shaveId: string,
          videoSource: CreateVideoSourceData,
        ) => Promise<{ success: boolean; data?: Shave | undefined; error?: string }>;
        update: (
          id: string,
          data: UpdateShaveData,
        ) => Promise<{ success: boolean; data?: Shave | undefined; error?: string }>;
        updateStatus: (
          id: string,
          status: ShaveStatus,
        ) => Promise<{ success: boolean; data?: Shave | undefined; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
      };
    };
  }
}

type ToolApprovalDecisionPayload =
  | { kind: "approve" }
  | { kind: "deny_stop"; feedback?: string }
  | { kind: "request_changes"; feedback: string };

export const ipcClient = window.electronAPI;
