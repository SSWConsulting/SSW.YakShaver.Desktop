import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  type PartialUserSettings,
  PartialUserSettingsSchema,
} from "../../shared/types/user-settings";
import { HotkeyManager } from "../services/settings/hotkey-manager";
import { UserSettingsStorage } from "../services/storage/user-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class UserSettingsIPCHandlers {
  private readonly storage: UserSettingsStorage;
  private readonly hotkeyManager: HotkeyManager;

  constructor() {
    this.storage = UserSettingsStorage.getInstance();
    this.hotkeyManager = HotkeyManager.getInstance();
    this.registerHandlers();
    void this.syncLoginItemSettings();
    void this.syncHotkeysToAllWindows();
    void this.registerGlobalHotkeys();
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

  private async syncHotkeysToAllWindows(): Promise<void> {
    try {
      const settings = await this.storage.getSettingsAsync();
      if (settings.hotkeys) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC_CHANNELS.SETTINGS_HOTKEY_UPDATE, settings.hotkeys);
        }
      }
    } catch (error) {
      console.error("Failed to sync hotkeys to windows on startup", error);
    }
  }

  private async registerGlobalHotkeys(): Promise<void> {
    try {
      const settings = await this.storage.getSettingsAsync();
      const result = this.hotkeyManager.registerHotkeys(settings.hotkeys);
      if (!result.success && result.failedActions) {
        console.error("Failed to register some hotkeys on startup:", result.failedActions);
      }
    } catch (error) {
      console.error("Failed to register global hotkeys on startup", error);
    }
  }

  private async handleHotkeysUpdate(
    hotkeys: PartialUserSettings["hotkeys"],
  ): Promise<{ success: boolean; error?: string }> {
    if (!hotkeys) {
      return { success: true };
    }

    const result = this.hotkeyManager.registerHotkeys(hotkeys);

    if (!result.success && result.failedActions) {
      const currentSettings = await this.storage.getSettingsAsync();
      this.hotkeyManager.registerHotkeys(currentSettings.hotkeys);

      const failedHotkey = result.failedActions[0];
      return {
        success: false,
        error: `Failed to register "${failedHotkey.keybind}": ${failedHotkey.reason}`,
      };
    }

    await this.storage.updateSettingsAsync({ hotkeys });

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.SETTINGS_HOTKEY_UPDATE, hotkeys);
    }

    return { success: true };
  }

  private async handleOpenAtLoginUpdate(openAtLogin: boolean): Promise<void> {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
    });
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.SETTINGS_UPDATE,
      async (_event: IpcMainInvokeEvent, patch: unknown) => {
        // Validate the patch
        const validation = PartialUserSettingsSchema.safeParse(patch);
        if (!validation.success) {
          console.error("Invalid settings patch:", validation.error);
          return { success: false, error: "Invalid settings data" };
        }

        const validPatch = validation.data;

        // Handle hotkeys separately (needs validation before saving)
        if (validPatch.hotkeys !== undefined) {
          const hotkeyResult = await this.handleHotkeysUpdate(validPatch.hotkeys);
          if (!hotkeyResult.success) {
            return hotkeyResult;
          }

          // Remove hotkeys from patch to avoid double-processing
          const { hotkeys, ...restOfPatch } = validPatch;

          // Save remaining settings
          if (Object.keys(restOfPatch).length > 0) {
            await this.storage.updateSettingsAsync(restOfPatch);

            // Apply side effects for other settings
            if (restOfPatch.openAtLogin !== undefined) {
              await this.handleOpenAtLoginUpdate(restOfPatch.openAtLogin);
            }
          }
        } else {
          // No hotkeys, just save and apply side effects
          await this.storage.updateSettingsAsync(validPatch);

          if (validPatch.openAtLogin !== undefined) {
            await this.handleOpenAtLoginUpdate(validPatch.openAtLogin);
          }
        }

        return { success: true };
      },
    );
  }
}
