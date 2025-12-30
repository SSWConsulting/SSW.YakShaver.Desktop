import type { NewShave, NewVideoFile, Shave } from "../../db/schema";
import * as dbShaveService from "../../db/services/shave-service";
import * as dbVideoFileService from "../../db/services/video-files-service";
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

  public createShave(shave: Omit<NewShave, "id">, videoFile?: Omit<NewVideoFile, "id">): Shave {
    try {
      let videoFileId: number | null = null;

      // If recording file is provided, try to create it
      if (videoFile) {
        try {
          const videoFileResult = dbVideoFileService.createVideoFile(videoFile);
          videoFileId = videoFileResult.id;
        } catch (err) {
          const errorMsg = formatErrorMessage(err);
          console.error("[ShaveService] Failed to create video file:", errorMsg);
        }
      }

      // Normalize YouTube URL before saving
      const normalizedShave = {
        ...shave,
        videoFileId: videoFileId ?? null,
        videoEmbedUrl: shave.videoEmbedUrl ? normalizeYouTubeUrl(shave.videoEmbedUrl) : null,
      };

      // Create shave with videoFileId (null if not provided or creation failed)
      const newShave = dbShaveService.createShave(normalizedShave);
      return newShave;
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public getShaveById(id: number): Shave | undefined {
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

  public updateShave(id: number, data: Partial<Omit<NewShave, "id">>): Shave | undefined {
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

  public attachVideoFileToShave(
    shaveId: number,
    videoFile: Omit<NewVideoFile, "id">,
  ): Shave | undefined {
    try {
      //In case user tries to shave the same video again, avoid overwriting existing videoFileId
      const existingShave = dbShaveService.getShaveById(shaveId);
      if (existingShave?.videoFileId) {
        return existingShave;
      }

      const videoFileResult = dbVideoFileService.createVideoFile(videoFile);
      return dbShaveService.updateShave(shaveId, { videoFileId: videoFileResult.id });
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public updateShaveStatus(id: number, status: ShaveStatus): Shave | undefined {
    try {
      return dbShaveService.updateShaveStatus(id, status);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public deleteShave(id: number): boolean {
    try {
      return dbShaveService.deleteShave(id);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }
}
