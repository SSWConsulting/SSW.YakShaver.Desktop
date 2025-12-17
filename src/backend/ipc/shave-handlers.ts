import { ipcMain } from "electron";
import type { NewShave, Shave } from "../db/schema";
import {
  createShave,
  deleteShave,
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

  private async createShave(data: Omit<NewShave, "id">): Promise<Shave> {
    try {
      return await createShave(data);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private async getShaveById(id: number): Promise<Shave | undefined> {
    try {
      return await getShaveById(id);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private async getAllShaves(): Promise<Shave[]> {
    try {
      return await getAllShaves();
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private async updateShave(
    id: number,
    data: Partial<Omit<NewShave, "id">>,
  ): Promise<Shave | undefined> {
    try {
      return await updateShave(id, data);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private async updateShaveStatus(
    id: number,
    status: "Pending" | "Processing" | "Completed" | "Failed",
  ): Promise<Shave | undefined> {
    try {
      return await updateShaveStatus(id, status);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }

  private async deleteShave(id: number): Promise<void> {
    try {
      await deleteShave(id);
    } catch (error) {
      throw new Error(formatErrorMessage(error));
    }
  }
}
