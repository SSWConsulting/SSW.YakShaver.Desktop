import type { MCPServerConfig } from "@/components/mcp/McpServerForm";
import type {
  AuthResult,
  AuthState,
  ConvertVideoToMp3Result,
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
          outputPath: string
        ) => Promise<ConvertVideoToMp3Result>;
      };
      screenRecording: {
        start: (sourceId?: string) => Promise<ScreenRecordingStartResult>;
        stop: (videoData: Uint8Array) => Promise<ScreenRecordingStopResult>;
        listSources: () => Promise<ScreenSource[]>;
        cleanupTempFile: (filePath: string) => Promise<void>;
        triggerTranscription: (
          filePath: string,
          videoUploadResult: VideoUploadResult
        ) => Promise<void>;
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
      openai: {
        getTranscription: (audioFilePath: string) => Promise<string>;
        processTranscript: (transcript: string) => Promise<string>;
        onTranscriptionStarted: (callback: () => void) => () => void;
        onTranscriptionCompleted: (
          callback: (transcript: string) => void
        ) => () => void;
        onTranscriptionError: (callback: (error: string) => void) => () => void;
      };
      workflow: {
        onProgress: (callback: (progress: unknown) => void) => () => void;
        retryTaskExecution: (intermediateOutput: string) => Promise<{
          success: boolean;
          finalOutput?: string | null;
          error?: string;
        }>;
      };
      mcp: {
        processMessage: (
          prompt: string,
          videoUrl?: string,
          options?: { serverFilter?: string[] }
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
          }) => void
        ) => () => void;
        listServers: () => Promise<MCPServerConfig[]>;
        addServer: (config: MCPServerConfig) => Promise<{ success: boolean }>;
        updateServer: (
          name: string,
          config: MCPServerConfig
        ) => Promise<{ success: boolean }>;
        removeServer: (name: string) => Promise<{ success: boolean }>;
        checkServerHealth: (name: string) => Promise<HealthStatusInfo>;
      };
      settings: {
        getCustomPrompt: () => Promise<string>;
        setCustomPrompt: (prompt: string) => Promise<{ success: boolean }>;
      };
    };
  }
}

export const ipcClient = window.electronAPI;
