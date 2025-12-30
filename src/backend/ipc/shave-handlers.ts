import { ipcMain } from "electron";
import type { NewShave, NewVideoFile } from "../db/schema";
import { ShaveService } from "../services/shave/shave-service";
import type { ShaveStatus } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class ShaveIPCHandlers {
  private service = ShaveService.getInstance();

  constructor() {
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_CREATE,
      (_, shave: Omit<NewShave, "id">, videoFile?: Omit<NewVideoFile, "id">) =>
        this.createShave(shave, videoFile),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_BY_ID, (_, id: number) => this.getShaveById(id));
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_ALL, () => this.getAllShaves());
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_ATTACH_VIDEO_FILE,
      (_, shaveId: number, videoFile: Omit<NewVideoFile, "id">) =>
        this.attachVideoFileToShave(shaveId, videoFile),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_FIND_BY_VIDEO_URL, (_, videoEmbedUrl: string) =>
      this.findByVideoUrl(videoEmbedUrl),
    );
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_UPDATE,
      (_, id: number, data: Partial<Omit<NewShave, "id">>) => this.updateShave(id, data),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_UPDATE_STATUS, (_, id: number, status: ShaveStatus) =>
      this.updateShaveStatus(id, status),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_DELETE, (_, id: number) => this.deleteShave(id));
  }

  private createShave(shave: Omit<NewShave, "id">, videoFile?: Omit<NewVideoFile, "id">) {
    try {
      return { success: true, data: this.service.createShave(shave, videoFile) };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private getShaveById(id: number) {
    try {
      const data = this.service.getShaveById(id);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private getAllShaves() {
    try {
      const data = this.service.getAllShaves();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private findByVideoUrl(videoEmbedUrl: string) {
    try {
      const data = this.service.findShaveByVideoUrl(videoEmbedUrl);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private updateShave(id: number, data: Partial<Omit<NewShave, "id">>) {
    try {
      const result = this.service.updateShave(id, data);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private updateShaveStatus(id: number, status: ShaveStatus) {
    try {
      const result = this.service.updateShaveStatus(id, status);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private attachVideoFileToShave(shaveId: number, videoFile: Omit<NewVideoFile, "id">) {
    try {
      const result = this.service.attachVideoFileToShave(shaveId, videoFile);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  private deleteShave(id: number) {
    try {
      const result = this.service.deleteShave(id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }
}
