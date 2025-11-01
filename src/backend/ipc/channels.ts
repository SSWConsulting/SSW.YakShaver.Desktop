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

  // OpenAI
  OPENAI_GET_TRANSCRIPTION: "openai:get-transcription",
  OPENAI_PROCESS_TRANSCRIPT: "openai:process-transcript",
  TRANSCRIPTION_STARTED: "transcription-started",
  TRANSCRIPTION_COMPLETED: "transcription-completed",
  TRANSCRIPTION_ERROR: "transcription-error",

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

  // Automated workflow
  WORKFLOW_PROGRESS: "workflow:progress",
  WORKFLOW_RETRY_TASK_EXECUTION: "workflow:retry-task-execution",

  // Video upload with recorded file
  UPLOAD_RECORDED_VIDEO: "upload-recorded-video",

  // Video processing - the main process pipeline
  PROCESS_VIDEO: "process-video",

  // Settings
  SETTINGS_GET_CUSTOM_PROMPT: "settings:get-custom-prompt",
  SETTINGS_SET_CUSTOM_PROMPT: "settings:set-custom-prompt",
} as const;
