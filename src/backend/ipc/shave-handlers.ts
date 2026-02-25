import { ipcMain } from "electron";
import type {
  CreateShaveData,
  CreateVideoData,
  CreateVideoSourceData,
  UpdateShaveData,
} from "../db/schema";
import { ShaveService } from "../services/shave/shave-service";
import type { ShaveStatus } from "../types";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class ShaveIPCHandlers {
  private service = ShaveService.getInstance();

  constructor() {
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_CREATE,
      (
        _,
        shave: CreateShaveData,
        videoFile?: CreateVideoData,
        videoSource?: CreateVideoSourceData,
      ) => this.createShave(shave, videoFile, videoSource),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_BY_ID, (_, id: string) => this.getShaveById(id));
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_ALL, () => this.getAllShaves());
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_ATTACH_VIDEO_SOURCE,
      (_, shaveId: string, videoSource: CreateVideoSourceData) =>
        this.attachVideoSourceToShave(shaveId, videoSource),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_FIND_BY_VIDEO_URL, (_, videoEmbedUrl: string) =>
      this.findByVideoUrl(videoEmbedUrl),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_UPDATE, (_, id: string, data: UpdateShaveData) =>
      this.updateShave(id, data),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_UPDATE_STATUS, (_, id: string, status: ShaveStatus) =>
      this.updateShaveStatus(id, status),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_DELETE, (_, id: string) => this.deleteShave(id));
  }

  private createShave(
    shave: CreateShaveData,
    videoFile?: CreateVideoData,
    videoSource?: CreateVideoSourceData,
  ) {
    try {
      return { success: true, data: this.service.createShave(shave, videoFile, videoSource) };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private getShaveById(id: string) {
    try {
      const data = this.service.getShaveById(id);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private getAllShaves() {
    try {
      const data = this.service.getAllShaves();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private findByVideoUrl(videoEmbedUrl: string) {
    try {
      const data = this.service.findShaveByVideoUrl(videoEmbedUrl);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private updateShave(id: string, data: UpdateShaveData) {
    try {
      const result = this.service.updateShave(id, data);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private updateShaveStatus(id: string, status: ShaveStatus) {
    try {
      const result = this.service.updateShaveStatus(id, status);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private attachVideoSourceToShave(shaveId: string, videoSource: CreateVideoSourceData) {
    try {
      const result = this.service.attachVideoSourceToShave(shaveId, videoSource);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }

  private deleteShave(id: string) {
    try {
      const result = this.service.deleteShave(id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatAndReportError(error, "shave_operation") };
    }
  }
}
