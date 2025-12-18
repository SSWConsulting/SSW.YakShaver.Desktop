import { ipcMain } from "electron";
import type { NewShave, Shave } from "../db/schema";
import {
  createShave,
  deleteShave,
  findShaveByVideoUrl,
  getAllShaves,
  getShaveById,
  updateShave,
  updateShaveStatus,
} from "../db/services/shave-service";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class ShaveIPCHandlers {
  constructor() {
    ipcMain.handle(IPC_CHANNELS.SHAVE_CREATE, (_, data: Omit<NewShave, "id">) =>
      this.createShave(data),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_BY_ID, (_, id: number) => this.getShaveById(id));
    ipcMain.handle(IPC_CHANNELS.SHAVE_GET_ALL, () => this.getAllShaves());
    ipcMain.handle(IPC_CHANNELS.SHAVE_FIND_BY_VIDEO_URL, (_, videoEmbedUrl: string) =>
      this.findByVideoUrl(videoEmbedUrl),
    );
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_UPDATE,
      (_, id: number, data: Partial<Omit<NewShave, "id">>) => this.updateShave(id, data),
    );
    ipcMain.handle(
      IPC_CHANNELS.SHAVE_UPDATE_STATUS,
      (_, id: number, status: "Pending" | "Processing" | "Completed" | "Failed") =>
        this.updateShaveStatus(id, status),
    );
    ipcMain.handle(IPC_CHANNELS.SHAVE_DELETE, (_, id: number) => this.deleteShave(id));
  }

  private createShave(data: Omit<NewShave, "id">): Shave {
    try {
      return createShave(data);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private getShaveById(id: number): Shave | undefined {
    try {
      return getShaveById(id);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private getAllShaves(): Shave[] {
    try {
      return getAllShaves();
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private findByVideoUrl(videoEmbedUrl: string): Shave | undefined {
    try {
      return findShaveByVideoUrl(videoEmbedUrl);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private updateShave(
    id: number,
    data: Partial<Omit<NewShave, "id">>,
  ): Shave | undefined {
    try {
      return updateShave(id, data);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private updateShaveStatus(
    id: number,
    status: "Pending" | "Processing" | "Completed" | "Failed",
  ): Shave | undefined {
    try {
      return updateShaveStatus(id, status);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private deleteShave(id: number): void {
    try {
      deleteShave(id);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }
}
