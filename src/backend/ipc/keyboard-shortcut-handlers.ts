import { BrowserWindow, ipcMain } from "electron";
import type { KeyboardShortcutSettings } from "../../shared/types/keyboard-shortcuts";
import type { ShortcutManager } from "../services/shortcut-manager";
import { KeyboardShortcutStorage } from "../services/storage/keyboard-shortcut-storage";
import type { TrayManager } from "../services/tray-manager";
import { IPC_CHANNELS } from "./channels";

interface AutoLaunchHandler {
  (enabled: boolean): void;
}

export class KeyboardShortcutIPCHandlers {
  private storage = KeyboardShortcutStorage.getInstance();
  private shortcutManager: ShortcutManager;
  private trayManager: TrayManager;
  private onAutoLaunchChange: AutoLaunchHandler;

  constructor(
    shortcutManager: ShortcutManager,
    trayManager: TrayManager,
    onAutoLaunchChange: AutoLaunchHandler,
  ) {
    this.shortcutManager = shortcutManager;
    this.trayManager = trayManager;
    this.onAutoLaunchChange = onAutoLaunchChange;

    ipcMain.handle(IPC_CHANNELS.KEYBOARD_SHORTCUT_GET, async () => {
      return await this.getSettings();
    });

    ipcMain.handle(IPC_CHANNELS.KEYBOARD_SHORTCUT_SET, async (_event, shortcut: string) => {
      return await this.setRecordShortcut(shortcut);
    });

    ipcMain.handle(
      IPC_CHANNELS.KEYBOARD_SHORTCUT_SET_AUTO_LAUNCH,
      async (_event, enabled: boolean) => {
        return await this.setAutoLaunch(enabled);
      },
    );
  }

  private async getSettings(): Promise<KeyboardShortcutSettings> {
    try {
      return await this.storage.getSettings();
    } catch (error) {
      console.error("Failed to get keyboard shortcut settings:", error);
      throw error;
    }
  }

  private async setRecordShortcut(shortcut: string): Promise<{ success: boolean; error?: string }> {
    try {
      const registered = this.shortcutManager.registerShortcut(shortcut);

      if (!registered) {
        return {
          success: false,
          error: `Failed to register shortcut "${shortcut}". It may be reserved by the OS or another application. Try a different key combination.`,
        };
      }

      await this.storage.setRecordShortcut(shortcut);
      this.trayManager.updateTrayMenu(shortcut);

      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.KEYBOARD_SHORTCUT_CHANGED, shortcut);
      }

      return { success: true };
    } catch (error) {
      console.error("Failed to set record shortcut:", error);
      throw error;
    }
  }

  private async setAutoLaunch(enabled: boolean): Promise<{ success: boolean }> {
    try {
      await this.storage.setAutoLaunch(enabled);
      this.onAutoLaunchChange(enabled);
      return { success: true };
    } catch (error) {
      console.error("Failed to set auto launch:", error);
      throw error;
    }
  }
}
