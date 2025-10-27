import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { MCPServerConfig } from "./services/mcp/types";

// TODO: the IPC_CHANNELS constant is repeated in the channels.ts file;
// Need to make single source of truth
// Importing IPC_CHANNELS from channels.ts file is breaking the preload script
const IPC_CHANNELS = {
  // YouTube auth and config
  YOUTUBE_START_AUTH: "youtube:start-auth",
  YOUTUBE_GET_AUTH_STATUS: "youtube:get-auth-status",
  YOUTUBE_GET_CURRENT_USER: "youtube:get-current-user",
  YOUTUBE_DISCONNECT: "youtube:disconnect",
  YOUTUBE_REFRESH_TOKEN: "youtube:refresh-token",
  YOUTUBE_UPLOAD_VIDEO: "youtube:upload-video",

  CONFIG_HAS_YOUTUBE: "config:has-youtube",
  CONFIG_GET_YOUTUBE: "config:get-youtube",

  // Video conversion
  SELECT_VIDEO_FILE: "select-video-file",
  SELECT_OUTPUT_DIRECTORY: "select-output-directory",
  CONVERT_VIDEO_TO_MP3: "convert-video-to-mp3",

  // Screen recording
  START_SCREEN_RECORDING: "start-screen-recording",
  STOP_SCREEN_RECORDING: "stop-screen-recording",
  STOP_RECORDING_FROM_CONTROL_BAR: "stop-recording-from-control-bar",
  LIST_SCREEN_SOURCES: "list-screen-sources",
  CLEANUP_TEMP_FILE: "cleanup-temp-file",
  TRIGGER_TRANSCRIPTION: "trigger-transcription",
  SHOW_CONTROL_BAR: "show-control-bar",
  HIDE_CONTROL_BAR: "hide-control-bar",

  // OpenAI
  OPENAI_GET_TRANSCRIPTION: "openai:get-transcription",
  OPENAI_PROCESS_TRANSCRIPT: "openai:process-transcript",

  // LLM
  LLM_SET_CONFIG: "llm:set-config",
  LLM_GET_CONFIG: "llm:get-config",
  LLM_CLEAR_CONFIG: "llm:clear-config",

  // MCP
  MCP_PROCESS_MESSAGE: "mcp:process-message",
  MCP_PREFILL_PROMPT: "mcp:prefill-prompt",
  MCP_STEP_UPDATE: "mcp:step-update",
  MCP_LIST_SERVERS: "mcp:list-servers",
  MCP_ADD_SERVER: "mcp:add-server",
  MCP_UPDATE_SERVER: "mcp:update-server",
  MCP_REMOVE_SERVER: "mcp:remove-server",
  MCP_CHECK_SERVER_HEALTH: "mcp:check-server-health",
  TRANSCRIPTION_STARTED: "transcription-started",
  TRANSCRIPTION_COMPLETED: "transcription-completed",
  TRANSCRIPTION_ERROR: "transcription-error",

  // Automated workflow
  WORKFLOW_PROGRESS: "workflow:progress",
  WORKFLOW_RETRY_TASK_EXECUTION: "workflow:retry-task-execution",

  // Video upload with recorded file
  UPLOAD_RECORDED_VIDEO: "upload-recorded-video",

  // Settings
  SETTINGS_GET_CUSTOM_PROMPT: "settings:get-custom-prompt",
  SETTINGS_SET_CUSTOM_PROMPT: "settings:set-custom-prompt",
} as const;

const onIpcEvent = <T>(channel: string, callback: (payload: T) => void) => {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const electronAPI = {
  youtube: {
    startAuth: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_START_AUTH),
    getAuthStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_GET_AUTH_STATUS),
    getCurrentUser: () =>
      ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_GET_CURRENT_USER),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_DISCONNECT),
    refreshToken: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_REFRESH_TOKEN),
    uploadVideo: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_UPLOAD_VIDEO),
    uploadRecordedVideo: (filePath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.UPLOAD_RECORDED_VIDEO, filePath),
  },
  config: {
    hasYouTube: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_HAS_YOUTUBE),
    getYouTube: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_YOUTUBE),
  },
  video: {
    selectVideoFile: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_VIDEO_FILE),
    selectOutputDirectory: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SELECT_OUTPUT_DIRECTORY),
    convertVideoToMp3: (inputPath: string, outputPath: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.CONVERT_VIDEO_TO_MP3,
        inputPath,
        outputPath
      ),
  },
  screenRecording: {
    start: (sourceId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.START_SCREEN_RECORDING, sourceId),
    stop: (videoData: Uint8Array) =>
      ipcRenderer.invoke(IPC_CHANNELS.STOP_SCREEN_RECORDING, videoData),
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_SCREEN_SOURCES),
    cleanupTempFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_TEMP_FILE, filePath),
    triggerTranscription: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_TRANSCRIPTION, filePath),
    showControlBar: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_CONTROL_BAR),
    hideControlBar: () => ipcRenderer.invoke(IPC_CHANNELS.HIDE_CONTROL_BAR),
    stopFromControlBar: () =>
      ipcRenderer.invoke(IPC_CHANNELS.STOP_RECORDING_FROM_CONTROL_BAR),
    onStopRequest: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("stop-recording-request", listener);
      return () =>
        ipcRenderer.removeListener("stop-recording-request", listener);
    },
  },
  controlBar: {
    onTimeUpdate: (callback: (time: string) => void) => {
      const listener = (_: unknown, time: string) => callback(time);
      ipcRenderer.on("update-recording-time", listener);
      return () =>
        ipcRenderer.removeListener("update-recording-time", listener);
    },
  },
  openai: {
    getTranscription: (audioFilePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPENAI_GET_TRANSCRIPTION, audioFilePath),
    processTranscript: (transcript: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPENAI_PROCESS_TRANSCRIPT, transcript),
    onTranscriptionStarted: (callback: () => void) =>
      onIpcEvent<void>(IPC_CHANNELS.TRANSCRIPTION_STARTED, callback),
    onTranscriptionCompleted: (callback: (transcript: string) => void) =>
      onIpcEvent<string>(IPC_CHANNELS.TRANSCRIPTION_COMPLETED, callback),
  },
  workflow: {
    onProgress: (callback: (progress: unknown) => void) =>
      onIpcEvent(IPC_CHANNELS.WORKFLOW_PROGRESS, callback),
    retryTaskExecution: (intermediateOutput: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.WORKFLOW_RETRY_TASK_EXECUTION,
        intermediateOutput
      ),
    onTranscriptionError: (callback: (error: string) => void) =>
      onIpcEvent<string>(IPC_CHANNELS.TRANSCRIPTION_ERROR, (error) =>
        callback(error)
      ),
  },
  llm: {
    setConfig: (config: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_SET_CONFIG, config),
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_GET_CONFIG),
    clearConfig: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_CLEAR_CONFIG),
  },
  mcp: {
    processMessage: (prompt: string, options?: { serverFilter?: string[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_PROCESS_MESSAGE, prompt, options),
    prefillPrompt: (text: string) =>
      ipcRenderer.send(IPC_CHANNELS.MCP_PREFILL_PROMPT, text),
    onPrefillPrompt: (callback: (text: string) => void) =>
      onIpcEvent<string>(IPC_CHANNELS.MCP_PREFILL_PROMPT, callback),
    onStepUpdate: (
      callback: (step: {
        type: "start" | "tool_call" | "final_result";
        message?: string;
        toolName?: string;
        serverName?: string;
      }) => void
    ) => onIpcEvent(IPC_CHANNELS.MCP_STEP_UPDATE, callback),
    listServers: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST_SERVERS),
    addServer: (config: MCPServerConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD_SERVER, config),
    updateServer: (name: string, config: MCPServerConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_UPDATE_SERVER, name, config),
    removeServer: (name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_REMOVE_SERVER, name),
    checkServerHealth: (name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_CHECK_SERVER_HEALTH, name),
  },
  settings: {
    getCustomPrompt: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_CUSTOM_PROMPT),
    setCustomPrompt: (prompt: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_CUSTOM_PROMPT, prompt),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
