import type {
  CreateShaveData,
  CreateVideoData,
  CreateVideoSourceData,
  Shave,
  UpdateShaveData,
} from "../../db/schema";
import * as dbShaveService from "../../db/services/shave-service";
import * as dbVideoFileService from "../../db/services/video-files-service";
import * as dbVideoSourceService from "../../db/services/video-source-service";
import type { ShaveStatus } from "../../types";
import { formatErrorMessage } from "../../utils/error-utils";
import { normalizeYouTubeUrl } from "../../utils/youtube-url-utils";

export class ShaveService {
  private static instance: ShaveService;

  private constructor() {}

  public static getInstance(): ShaveService {
    ShaveService.instance ??= new ShaveService();
    return ShaveService.instance;
  }

  public createShave(
    shave: CreateShaveData,
    videoFile?: CreateVideoData,
    videoSource?: CreateVideoSourceData,
  ): Shave {
    try {
      let videoSourceId: string | null = null;

      // If video source is provided, create it first
      if (videoSource) {
        try {
          const videoSourceResult = dbVideoSourceService.createVideoSource(videoSource);
          videoSourceId = videoSourceResult.id;
        } catch (err) {
          const errorMsg = formatErrorMessage(err);
          console.error("[ShaveService] Failed to create video source:", errorMsg);
        }
      }

      // If recording file is provided, create it with the video source ID
      if (videoFile) {
        try {
          const videoFileData = {
            ...videoFile,
            videoSourceId: videoSourceId,
          };
          dbVideoFileService.createVideoFile(videoFileData);
        } catch (err) {
          const errorMsg = formatErrorMessage(err);
          console.error("[ShaveService] Failed to create video file:", errorMsg);
        }
      }

      // Normalize YouTube URL before saving
      const normalizedShave = {
        ...shave,
        videoSourceId: videoSourceId ?? null,
        videoEmbedUrl: shave.videoEmbedUrl ? normalizeYouTubeUrl(shave.videoEmbedUrl) : null,
      };

      // Create shave with videoSourceId (null if not provided or creation failed)
      const newShave = dbShaveService.createShave(normalizedShave);
      return newShave;
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public getShaveById(id: string): Shave | undefined {
    try {
      return dbShaveService.getShaveById(id);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public getAllShaves(): Shave[] {
    try {
      return dbShaveService.getAllShaves();
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public findShaveByVideoUrl(videoEmbedUrl: string): Shave | undefined {
    try {
      // Normalize YouTube URL before searching
      const normalizedUrl = normalizeYouTubeUrl(videoEmbedUrl);
      if (!normalizedUrl) return undefined;

      return dbShaveService.findShaveByVideoUrl(normalizedUrl);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public updateShave(id: string, data: UpdateShaveData): Shave | undefined {
    try {
      // Normalize YouTube URL if videoEmbedUrl is being updated
      const normalizedData = { ...data };
      if ("videoEmbedUrl" in data) {
        normalizedData.videoEmbedUrl = normalizeYouTubeUrl(data.videoEmbedUrl);
      }

      return dbShaveService.updateShave(id, normalizedData);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public attachVideoSourceToShave(
    shaveId: string,
    videoSource: CreateVideoSourceData,
  ): Shave | undefined {
    try {
      //In case user tries to shave the same video again, avoid overwriting existing videoSourceId
      const existingShave = dbShaveService.getShaveById(shaveId);
      if (existingShave?.videoSourceId) {
        return existingShave;
      }

      const videoSourceResult = dbVideoSourceService.createVideoSource(videoSource);
      return dbShaveService.updateShave(shaveId, { videoSourceId: videoSourceResult.id });
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public updateShaveStatus(id: string, status: ShaveStatus): Shave | undefined {
    try {
      return dbShaveService.updateShaveStatus(id, status);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  /**
   * Mark video file associated with a shave as deleted (soft delete)
   * @param shaveId The shave ID
   * @returns true if video file was marked as deleted, false otherwise
   */
  public markShaveVideoFilesAsDeleted(shaveId: string): boolean {
    try {
      const shave = dbShaveService.getShaveById(shaveId);
      if (!shave?.videoSourceId) {
        return false;
      }

      const videoFiles = dbVideoFileService.getVideoFilesByVideoSourceId(shave.videoSourceId);

      for (const videoFile of videoFiles) {
        if (!videoFile.isDeleted) {
          dbVideoFileService.markVideoFileAsDeleted(videoFile.id);
          return true;
        }
      }

      return false;
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public deleteShave(id: string): boolean {
    try {
      return dbShaveService.deleteShave(id);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }
}
