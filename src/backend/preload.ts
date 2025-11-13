import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { VideoUploadResult } from "./services/auth/types";
import type { MCPServerConfig } from "./services/mcp/types";
import type { ReleaseChannel } from "./services/storage/release-channel-storage";

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
  MINIMIZE_MAIN_WINDOW: "minimize-main-window",
  RESTORE_MAIN_WINDOW: "restore-main-window",

  // LLM
  LLM_SET_CONFIG: "llm:set-config",
  LLM_GET_CONFIG: "llm:get-config",
  LLM_CLEAR_CONFIG: "llm:clear-config",
  LLM_CHECK_HEALTH: "llm:check-health",

  // MCP
  MCP_PROCESS_MESSAGE: "mcp:process-message",
  MCP_PREFILL_PROMPT: "mcp:prefill-prompt",
  MCP_STEP_UPDATE: "mcp:step-update",
  MCP_LIST_SERVERS: "mcp:list-servers",
  MCP_ADD_SERVER: "mcp:add-server",
  MCP_UPDATE_SERVER: "mcp:update-server",
  MCP_REMOVE_SERVER: "mcp:remove-server",
  MCP_CHECK_SERVER_HEALTH: "mcp:check-server-health",

  // Automated workflow
  WORKFLOW_PROGRESS: "workflow:progress",

  // Video upload with recorded file
  UPLOAD_RECORDED_VIDEO: "upload-recorded-video",

  // Video processing - the main process pipeline
  PROCESS_VIDEO: "process-video",
  RETRY_VIDEO: "retry-video",

  // Settings
  SETTINGS_GET_ALL_PROMPTS: "settings:get-all-prompts",
  SETTINGS_GET_ACTIVE_PROMPT: "settings:get-active-prompt",
  SETTINGS_ADD_PROMPT: "settings:add-prompt",
  SETTINGS_UPDATE_PROMPT: "settings:update-prompt",
  SETTINGS_DELETE_PROMPT: "settings:delete-prompt",
  SETTINGS_SET_ACTIVE_PROMPT: "settings:set-active-prompt",

  // Release Channel
  RELEASE_CHANNEL_GET: "release-channel:get",
  RELEASE_CHANNEL_SET: "release-channel:set",
  RELEASE_CHANNEL_LIST_RELEASES: "release-channel:list-releases",
  RELEASE_CHANNEL_CHECK_UPDATES: "release-channel:check-updates",
  RELEASE_CHANNEL_GET_CURRENT_VERSION: "release-channel:get-current-version",

  // GitHub Token
  GITHUB_TOKEN_GET: "github-token:get",
  GITHUB_TOKEN_SET: "github-token:set",
  GITHUB_TOKEN_CLEAR: "github-token:clear",
  GITHUB_TOKEN_HAS: "github-token:has",
} as const;

const onIpcEvent = <T>(channel: string, callback: (payload: T) => void) => {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const electronAPI = {
  pipelines: {
    processVideo: (filePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_VIDEO, filePath),
    retryVideo: (intermediateOutput: string, videoUploadResult: VideoUploadResult) =>
      ipcRenderer.invoke(IPC_CHANNELS.RETRY_VIDEO, intermediateOutput, videoUploadResult),
  },
  youtube: {
    startAuth: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_START_AUTH),
    getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_GET_AUTH_STATUS),
    getCurrentUser: () => ipcRenderer.invoke(IPC_CHANNELS.YOUTUBE_GET_CURRENT_USER),
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
    selectOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_OUTPUT_DIRECTORY),
    // TODO: Should be removed. this function has been moved to processVideo pipeline
    convertVideoToMp3: (inputPath: string, outputPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONVERT_VIDEO_TO_MP3, inputPath, outputPath),
  },
  screenRecording: {
    start: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.START_SCREEN_RECORDING, sourceId),
    stop: (videoData: Uint8Array) =>
      ipcRenderer.invoke(IPC_CHANNELS.STOP_SCREEN_RECORDING, videoData),
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_SCREEN_SOURCES),
    cleanupTempFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_TEMP_FILE, filePath),
    showControlBar: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_CONTROL_BAR),
    hideControlBar: () => ipcRenderer.invoke(IPC_CHANNELS.HIDE_CONTROL_BAR),
    stopFromControlBar: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_RECORDING_FROM_CONTROL_BAR),
    minimizeMainWindow: () => ipcRenderer.invoke(IPC_CHANNELS.MINIMIZE_MAIN_WINDOW),
    restoreMainWindow: () => ipcRenderer.invoke(IPC_CHANNELS.RESTORE_MAIN_WINDOW),
    onStopRequest: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("stop-recording-request", listener);
      return () => ipcRenderer.removeListener("stop-recording-request", listener);
    },
  },
  controlBar: {
    onTimeUpdate: (callback: (time: string) => void) => {
      const listener = (_: unknown, time: string) => callback(time);
      ipcRenderer.on("update-recording-time", listener);
      return () => ipcRenderer.removeListener("update-recording-time", listener);
    },
  },
  workflow: {
    onProgress: (callback: (progress: unknown) => void) =>
      onIpcEvent(IPC_CHANNELS.WORKFLOW_PROGRESS, callback),
  },
  llm: {
    setConfig: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.LLM_SET_CONFIG, config),
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_GET_CONFIG),
    clearConfig: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_CLEAR_CONFIG),
    checkHealth: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_CHECK_HEALTH),
  },
  mcp: {
    processMessage: (
      prompt: string,
      videoUploadResult?: VideoUploadResult,
      options?: { serverFilter?: string[] },
    ) => ipcRenderer.invoke(IPC_CHANNELS.MCP_PROCESS_MESSAGE, prompt, videoUploadResult, options),
    prefillPrompt: (text: string) => ipcRenderer.send(IPC_CHANNELS.MCP_PREFILL_PROMPT, text),
    onPrefillPrompt: (callback: (text: string) => void) =>
      onIpcEvent<string>(IPC_CHANNELS.MCP_PREFILL_PROMPT, callback),
    onStepUpdate: (
      callback: (step: {
        type: "start" | "tool_call" | "final_result";
        message?: string;
        toolName?: string;
        serverName?: string;
      }) => void,
    ) => onIpcEvent(IPC_CHANNELS.MCP_STEP_UPDATE, callback),
    listServers: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST_SERVERS),
    addServer: (config: MCPServerConfig) => ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD_SERVER, config),
    updateServer: (name: string, config: MCPServerConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_UPDATE_SERVER, name, config),
    removeServer: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_REMOVE_SERVER, name),
    checkServerHealth: (name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_CHECK_SERVER_HEALTH, name),
  },
  settings: {
    getAllPrompts: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL_PROMPTS),
    getActivePrompt: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ACTIVE_PROMPT),
    addPrompt: (prompt: { name: string; content: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_ADD_PROMPT, prompt),
    updatePrompt: (id: string, updates: { name?: string; content?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE_PROMPT, id, updates),
    deletePrompt: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_DELETE_PROMPT, id),
    setActivePrompt: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_ACTIVE_PROMPT, id),
  },
  releaseChannel: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_GET),
    set: (channel: ReleaseChannel) => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_SET, channel),
    listReleases: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_LIST_RELEASES),
    checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_CHECK_UPDATES),
    getCurrentVersion: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_GET_CURRENT_VERSION),
  },
  githubToken: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_GET),
    set: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_SET, token),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_CLEAR),
    has: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_HAS),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
