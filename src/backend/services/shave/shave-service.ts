import type { NewShave, NewVideoFile, Shave } from "../../db/schema";
import * as dbShaveService from "../../db/services/shave-service";
import * as dbVideoFileService from "../../db/services/video-files-service";
import type { ShaveStatus } from "../../types";
import { formatErrorMessage } from "../../utils/error-utils";

export class ShaveService {
  private static instance: ShaveService;

  private constructor() {}

  public static getInstance(): ShaveService {
    ShaveService.instance ??= new ShaveService();
    return ShaveService.instance;
  }

  public createShaveWithRecording(
    shave: Omit<NewShave, "id">,
    recordingFile: Omit<NewVideoFile, "id">,
  ): Shave {
    try {
      let videoFileId: number | null = null;
      try {
        const videoFile = dbVideoFileService.createVideoFile(recordingFile);
        videoFileId = videoFile.id;
      } catch (err) {
        console.error("Failed to create video file:", formatErrorMessage(err));
      }
      // Create shave with videoFileId (null if video file creation failed)
      const newShave = dbShaveService.createShave({
        ...shave,
        videoFileId: videoFileId ?? null,
      });
      return newShave;
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public createShave(data: Omit<NewShave, "id">): Shave {
    try {
      return dbShaveService.createShave(data);
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
      return dbShaveService.findShaveByVideoUrl(videoEmbedUrl);
    } catch (err) {
      throw new Error(formatErrorMessage(err));
    }
  }

  public updateShave(id: number, data: Partial<Omit<NewShave, "id">>): Shave | undefined {
    try {
      return dbShaveService.updateShave(id, data);
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
