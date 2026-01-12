import type { ToolApprovalMode } from "@shared/types/tool-approval";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type {
  CreateShaveData,
  CreateVideoData,
  CreateVideoSourceData,
  UpdateShaveData,
} from "./db/schema";
import type { VideoUploadResult } from "./services/auth/types";
import type { ToolApprovalDecision } from "./services/mcp/mcp-orchestrator";
import type { MCPServerConfig, MCPToolSummary } from "./services/mcp/types";
import type { ReleaseChannel } from "./services/storage/release-channel-storage";
import type { ShaveStatus } from "./types";

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

  // Microsoft auth
  MS_AUTH_LOGIN: "msauth:login",
  MS_AUTH_LOGOUT: "msauth:logout",
  MS_AUTH_STATUS: "msauth:status",
  MS_AUTH_ACCOUNT_INFO: "msgraph:get-me",

  // Screen recording
  START_SCREEN_RECORDING: "start-screen-recording",
  START_RECORDING_TIMER: "start-recording-timer",
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
  MCP_LIST_SERVER_TOOLS: "mcp:list-server-tools",
  MCP_TOOL_APPROVAL_DECISION: "mcp:tool-approval-decision",
  MCP_ADD_TOOL_TO_WHITELIST: "mcp:add-tool-to-whitelist",

  // Automated workflow
  WORKFLOW_PROGRESS: "workflow:progress",

  // Video upload with recorded file
  UPLOAD_RECORDED_VIDEO: "upload-recorded-video",

  // Video processing - the main process pipeline
  PROCESS_VIDEO_FILE: "process-video:file",
  PROCESS_VIDEO_URL: "process-video:url",
  RETRY_VIDEO: "retry-video",

  // Settings
  SETTINGS_GET_ALL_PROMPTS: "settings:get-all-prompts",
  SETTINGS_GET_ACTIVE_PROMPT: "settings:get-active-prompt",
  SETTINGS_ADD_PROMPT: "settings:add-prompt",
  SETTINGS_UPDATE_PROMPT: "settings:update-prompt",
  SETTINGS_DELETE_PROMPT: "settings:delete-prompt",
  SETTINGS_SET_ACTIVE_PROMPT: "settings:set-active-prompt",
  SETTINGS_CLEAR_CUSTOM_PROMPTS: "settings:clear-custom-prompts",

  // Release Channel
  RELEASE_CHANNEL_GET: "release-channel:get",
  RELEASE_CHANNEL_SET: "release-channel:set",
  RELEASE_CHANNEL_LIST_RELEASES: "release-channel:list-releases",
  RELEASE_CHANNEL_CHECK_UPDATES: "release-channel:check-updates",
  RELEASE_CHANNEL_GET_CURRENT_VERSION: "release-channel:get-current-version",
  RELEASE_CHANNEL_DOWNLOAD_PROGRESS: "release-channel:download-progress",

  // GitHub Token
  GITHUB_TOKEN_GET: "github-token:get",
  GITHUB_TOKEN_SET: "github-token:set",
  GITHUB_TOKEN_CLEAR: "github-token:clear",
  GITHUB_TOKEN_HAS: "github-token:has",
  GITHUB_TOKEN_VERIFY: "github-token:verify",
  GITHUB_APP_GET_INSTALL_URL: "github-app:get-install-url",

  // Tool Approval Settings
  TOOL_APPROVAL_SETTINGS_GET: "tool-approval-settings:get",
  TOOL_APPROVAL_SETTINGS_SET_MODE: "tool-approval-settings:set-mode",

  // App Control
  APP_RESTART: "app:restart",
  APP_OPEN_EXTERNAL: "app:open-external",

  // Portal API
  PORTAL_GET_MY_SHAVES: "portal:get-my-shaves",

  // Shave Management
  SHAVE_CREATE: "shave:create",
  SHAVE_ATTACH_VIDEO_SOURCE: "shave:attach-video-source",
  SHAVE_GET_BY_ID: "shave:get-by-id",
  SHAVE_GET_ALL: "shave:get-all",
  SHAVE_FIND_BY_VIDEO_URL: "shave:find-by-video-url",
  SHAVE_UPDATE: "shave:update",
  SHAVE_UPDATE_STATUS: "shave:update-status",
  SHAVE_DELETE: "shave:delete",
} as const;

const onIpcEvent = <T>(channel: string, callback: (payload: T) => void) => {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const electronAPI = {
  pipelines: {
    processVideoFile: (filePath: string, shaveId?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, filePath, shaveId),
    processVideoUrl: (url: string, shaveId?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROCESS_VIDEO_URL, url, shaveId),
    retryVideo: (
      intermediateOutput: string,
      videoUploadResult: VideoUploadResult,
      shaveId?: number,
    ) =>
      ipcRenderer.invoke(IPC_CHANNELS.RETRY_VIDEO, intermediateOutput, videoUploadResult, shaveId),
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
  auth: {
    microsoft: {
      login: () => ipcRenderer.invoke(IPC_CHANNELS.MS_AUTH_LOGIN),
      logout: () => ipcRenderer.invoke(IPC_CHANNELS.MS_AUTH_LOGOUT),
      status: () => ipcRenderer.invoke(IPC_CHANNELS.MS_AUTH_STATUS),
      accountInfo: () => ipcRenderer.invoke(IPC_CHANNELS.MS_AUTH_ACCOUNT_INFO),
    },
  },
  screenRecording: {
    start: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.START_SCREEN_RECORDING, sourceId),
    startTimer: () => ipcRenderer.invoke(IPC_CHANNELS.START_RECORDING_TIMER),
    stop: (videoData: Uint8Array) =>
      ipcRenderer.invoke(IPC_CHANNELS.STOP_SCREEN_RECORDING, videoData),
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_SCREEN_SOURCES),
    cleanupTempFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_TEMP_FILE, filePath),
    showControlBar: (cameraDeviceId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHOW_CONTROL_BAR, cameraDeviceId),
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
        type:
          | "start"
          | "reasoning"
          | "tool_call"
          | "tool_result"
          | "final_result"
          | "tool_approval_required"
          | "tool_denied";
        message?: string;
        toolName?: string;
        serverName?: string;
        reasoning?: string;
        args?: unknown;
        result?: unknown;
        error?: string;
        requestId?: string;
        autoApproveAt?: number;
      }) => void,
    ) => onIpcEvent(IPC_CHANNELS.MCP_STEP_UPDATE, callback),
    respondToToolApproval: (requestId: string, decision: ToolApprovalDecision) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_TOOL_APPROVAL_DECISION, {
        requestId,
        decision,
      }),
    addToolToWhitelist: (toolName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD_TOOL_TO_WHITELIST, { toolName }),
    listServers: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST_SERVERS),
    addServerAsync: (config: MCPServerConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD_SERVER, config),
    updateServerAsync: (serverIdOrName: string, config: MCPServerConfig) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_UPDATE_SERVER, serverIdOrName, config),
    removeServerAsync: (serverIdOrName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_REMOVE_SERVER, serverIdOrName),
    checkServerHealthAsync: (serverIdOrName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_CHECK_SERVER_HEALTH, serverIdOrName),
    listServerTools: (serverIdOrName: string): Promise<MCPToolSummary[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST_SERVER_TOOLS, serverIdOrName),
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
    clearCustomPrompts: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CLEAR_CUSTOM_PROMPTS),
  },
  releaseChannel: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_GET),
    set: (channel: ReleaseChannel) => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_SET, channel),
    listReleases: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_LIST_RELEASES),
    checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_CHECK_UPDATES),
    getCurrentVersion: () => ipcRenderer.invoke(IPC_CHANNELS.RELEASE_CHANNEL_GET_CURRENT_VERSION),
    onDownloadProgress: (
      callback: (progress: { percent: number; transferred: number; total: number }) => void,
    ) => onIpcEvent(IPC_CHANNELS.RELEASE_CHANNEL_DOWNLOAD_PROGRESS, callback),
  },
  githubToken: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_GET),
    set: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_SET, token),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_CLEAR),
    has: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_HAS),
    verify: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GITHUB_TOKEN_VERIFY) as Promise<{
        isValid: boolean;
        username?: string;
        scopes?: string[];
        rateLimitRemaining?: number;
        error?: string;
      }>,
    getInstallUrl: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_APP_GET_INSTALL_URL),
  },
  toolApprovalSettings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.TOOL_APPROVAL_SETTINGS_GET),
    setMode: (mode: ToolApprovalMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.TOOL_APPROVAL_SETTINGS_SET_MODE, mode),
  },
  app: {
    restart: () => ipcRenderer.invoke(IPC_CHANNELS.APP_RESTART),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
  },
  portal: {
    getMyShaves: () => ipcRenderer.invoke(IPC_CHANNELS.PORTAL_GET_MY_SHAVES),
  },
  shave: {
    create: (
      shaveData: CreateShaveData,
      videoFile?: CreateVideoData,
      videoSource?: CreateVideoSourceData,
    ) => ipcRenderer.invoke(IPC_CHANNELS.SHAVE_CREATE, shaveData, videoFile, videoSource),
    attachVideoSource: (shaveId: string, videoSource: CreateVideoSourceData) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHAVE_ATTACH_VIDEO_SOURCE, shaveId, videoSource),
    getById: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHAVE_GET_BY_ID, id),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SHAVE_GET_ALL),
    findByVideoUrl: (videoEmbedUrl: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHAVE_FIND_BY_VIDEO_URL, videoEmbedUrl),
    update: (id: string, data: UpdateShaveData) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHAVE_UPDATE, id, data),
    updateStatus: (id: string, status: ShaveStatus) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHAVE_UPDATE_STATUS, id, status),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHAVE_DELETE, id),
  },
  // Camera window
  onSetCameraDevice: (callback: (deviceId: string) => void) => {
    const listener = (_: IpcRendererEvent, deviceId: string) => callback(deviceId);
    ipcRenderer.on("set-camera-device", listener);
    return () => ipcRenderer.removeListener("set-camera-device", listener);
  },
  cameraReady: () => ipcRenderer.send("camera-ready"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
