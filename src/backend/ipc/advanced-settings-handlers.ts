import { type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  type AppSettings,
  AppSettingsStorage,
} from "../services/storage/app-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class AdvancedSettingsIPCHandlers {
  private readonly storage = AppSettingsStorage.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.ADVANCED_SETTINGS_GET, async () => {
      return await this.storage.getSettings();
    });

    ipcMain.handle(
      IPC_CHANNELS.ADVANCED_SETTINGS_UPDATE,
      async (_event: IpcMainInvokeEvent, updates: Partial<AppSettings>) => {
        return await this.storage.updateSettings(updates ?? {});
      },
    );
  }
}

