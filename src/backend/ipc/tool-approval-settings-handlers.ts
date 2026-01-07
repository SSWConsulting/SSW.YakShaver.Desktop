import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  ToolApprovalSettingsStorage,
  type ToolApprovalMode,
} from "../services/storage/tool-approval-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class ToolApprovalSettingsIPCHandlers {
  private readonly storage: ToolApprovalSettingsStorage;

  constructor() {
    this.storage = ToolApprovalSettingsStorage.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.TOOL_APPROVAL_SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.TOOL_APPROVAL_SETTINGS_SET_MODE,
      async (_event: IpcMainInvokeEvent, mode: ToolApprovalMode) => {
        await this.storage.setToolApprovalModeAsync(mode);
        return { success: true };
      },
    );
  }
}