export interface StartRecordingResult {
  success: boolean;
  sourceId?: string;
  error?: string;
}

export interface StopRecordingResult {
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
}
