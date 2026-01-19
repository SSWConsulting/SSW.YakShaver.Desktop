import type { UserSettings } from "@shared/types/user-settings";
import { app, type IpcMainInvokeEvent, ipcMain } from "electron";
import { UserSettingsStorage } from "../services/storage/user-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class UserSettingsIPCHandlers {
  private readonly storage: UserSettingsStorage;

  constructor() {
    this.storage = UserSettingsStorage.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.SETTINGS_UPDATE,
      async (_event: IpcMainInvokeEvent, patch: Partial<UserSettings>) => {
        await this.storage.updateSettingsAsync(patch);
        if (patch.openAtLogin !== undefined) {
          app.setLoginItemSettings({
            openAtLogin: patch.openAtLogin,
            openAsHidden: false,
          });
        }

        return { success: true };
      },
    );
  }
}
