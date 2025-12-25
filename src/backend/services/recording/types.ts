export interface StartRecordingResult {
  success: boolean;
  sourceId?: string;
  error?: string;
}

export interface StopRecordingResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  duration?: number; // Duration in seconds
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
