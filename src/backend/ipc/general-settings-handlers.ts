import { type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  GeneralSettingsStorage,
  type ToolApprovalMode,
} from "../services/storage/general-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class GeneralSettingsIPCHandlers {
  private readonly storage: GeneralSettingsStorage;

  constructor() {
    this.storage = GeneralSettingsStorage.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.GENERAL_SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.GENERAL_SETTINGS_SET_MODE,
      async (_event: IpcMainInvokeEvent, mode: ToolApprovalMode) => {
        await this.storage.setToolApprovalModeAsync(mode);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.GENERAL_SETTINGS_SET_ONBOARDING,
      async (_event: IpcMainInvokeEvent, completed: boolean) => {
        await this.storage.setOnboardingCompletedAsync(completed);
        return { success: true };
      },
    );
  }
}
