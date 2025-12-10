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
  isMainWindow?: boolean;
}

export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId?: string;
  /** Scale factor of the display (for HiDPI/Retina displays) */
  scaleFactor?: number;
}
