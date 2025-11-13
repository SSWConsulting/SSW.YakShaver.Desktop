export const IPC_CHANNELS = {
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
  RECORDING_TIME_UPDATE: "recording-time-update",
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
