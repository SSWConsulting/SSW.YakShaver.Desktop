import { app, type IpcMainInvokeEvent, ipcMain } from "electron";
import { PartialUserSettingsSchema } from "../../shared/types/user-settings";
import { UserSettingsStorage } from "../services/storage/user-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class UserSettingsIPCHandlers {
  private readonly storage: UserSettingsStorage;

  constructor() {
    this.storage = UserSettingsStorage.getInstance();
    this.registerHandlers();
    void this.syncLoginItemSettings();
  }

  private async syncLoginItemSettings(): Promise<void> {
    try {
      const settings = await this.storage.getSettingsAsync();
      app.setLoginItemSettings({
        openAtLogin: settings.openAtLogin,
        openAsHidden: false,
      });
    } catch (error) {
      console.error("Failed to sync login item settings on startup", error);
    }
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.SETTINGS_UPDATE,
      async (_event: IpcMainInvokeEvent, patch: unknown) => {
        const validation = PartialUserSettingsSchema.safeParse(patch);
        if (!validation.success) {
          console.error("Invalid settings patch:", validation.error);
          return { success: false, error: "Invalid settings data" };
        }

        const validPatch = validation.data;
        await this.storage.updateSettingsAsync(validPatch);
        if (validPatch.openAtLogin !== undefined) {
          app.setLoginItemSettings({
            openAtLogin: validPatch.openAtLogin,
            openAsHidden: false,
          });
        }

        return { success: true };
      },
    );
  }
}
