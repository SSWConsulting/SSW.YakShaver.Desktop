export type { VideoFileMetadata } from "@shared/types";
export { ProgressStage, ShaveStatus } from "@shared/types";

export interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
}

export interface VideoFile {
  fileName: string;
  createdAt: string;
  duration: string;
  isChromeExtension: boolean;
}

export interface ShaveItem {
  id: string;
  title: string;
  videoFile: VideoFile;
  updatedAt: string;
  createdAt: string;
  shaveStatus: string;
  workItemType: string;
  projectName: string;
  workItemUrl: string;
  feedback: string | null;
  videoEmbedUrl: string;
}

export interface GetMyShavesResponse {
  items: ShaveItem[];
}
