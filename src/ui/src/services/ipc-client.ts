import type { MCPServerConfig } from "@/components/settings/mcp/McpServerForm";
import type {
  GitHubRelease,
  ReleaseChannel,
} from "@/components/settings/release-channels/ReleaseChannelManager";
import type {
  AuthResult,
  AuthState,
  ConvertVideoToMp3Result,
  CustomPrompt,
  HealthStatusInfo,
  LLMConfig,
  ScreenRecordingStartResult,
  ScreenRecordingStopResult,
  ScreenSource,
  TranscriptEntry,
  UserInfo,
  VideoUploadResult,
  YouTubeConfig,
} from "../types";

declare global {
  interface Window {
    electronAPI: {
      pipelines: {
        processVideo: (filePath?: string) => Promise<void>;
        retryVideo: (
          intermediateOutput: string,
          videoUploadResult: VideoUploadResult,
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
        setConfig: (config: LLMConfig) => Promise<{ success: boolean }>;
        getConfig: () => Promise<LLMConfig | null>;
        clearConfig: () => Promise<{ success: boolean }>;
        checkHealth: () => Promise<HealthStatusInfo>;
      };
      config: {
        hasYouTube: () => Promise<boolean>;
        getYouTube: () => Promise<YouTubeConfig | null>;
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
        stop: (videoData: Uint8Array) => Promise<ScreenRecordingStopResult>;
        listSources: () => Promise<ScreenSource[]>;
        cleanupTempFile: (filePath: string) => Promise<void>;
        showControlBar: () => Promise<{ success: boolean }>;
        hideControlBar: () => Promise<{ success: boolean }>;
        stopFromControlBar: () => Promise<{ success: boolean }>;
        minimizeMainWindow: () => Promise<{ success: boolean }>;
        restoreMainWindow: () => Promise<{ success: boolean }>;
        onStopRequest: (callback: () => void) => () => void;
      };
      controlBar: {
        onTimeUpdate: (callback: (time: string) => void) => () => void;
      };
      workflow: {
        onProgress: (callback: (progress: unknown) => void) => () => void;
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
        onStepUpdate: (
          callback: (step: {
            type: "start" | "tool_call" | "final_result";
            message?: string;
            toolName?: string;
            serverName?: string;
          }) => void,
        ) => () => void;
        listServers: () => Promise<MCPServerConfig[]>;
        addServer: (config: MCPServerConfig) => Promise<{ success: boolean }>;
        updateServer: (name: string, config: MCPServerConfig) => Promise<{ success: boolean }>;
        removeServer: (name: string) => Promise<{ success: boolean }>;
        checkServerHealth: (name: string) => Promise<HealthStatusInfo>;
      };
      settings: {
        getAllPrompts: () => Promise<Array<CustomPrompt>>;
        getActivePrompt: () => Promise<CustomPrompt | null>;
        addPrompt: (prompt: {
          name: string;
          description?: string;
          content: string;
        }) => Promise<CustomPrompt>;
        updatePrompt: (
          id: string,
          updates: { name?: string; description?: string; content?: string },
        ) => Promise<boolean>;
        deletePrompt: (id: string) => Promise<boolean>;
        setActivePrompt: (id: string) => Promise<boolean>;
      };
      releaseChannel: {
        get: () => Promise<ReleaseChannel>;
        set: (channel: ReleaseChannel) => Promise<void>;
        listReleases: () => Promise<{
          releases: Array<GitHubRelease>;
          error?: string;
        }>;
        checkUpdates: () => Promise<{
          available: boolean;
          error?: string;
          version?: string;
        }>;
        getCurrentVersion: () => Promise<string>;
      };
      githubToken: {
        get: () => Promise<string | undefined>;
        set: (token: string) => Promise<void>;
        clear: () => Promise<void>;
        has: () => Promise<boolean>;
      };
    };
  }
}

export const ipcClient = window.electronAPI;
