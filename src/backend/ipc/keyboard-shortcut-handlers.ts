import { ipcMain, type BrowserWindow } from "electron";
import type { KeyboardShortcutSettings } from "../../shared/types/keyboard-shortcuts";
import { KeyboardShortcutStorage } from "../services/storage/keyboard-shortcut-storage";
import { IPC_CHANNELS } from "./channels";

export class KeyboardShortcutIPCHandlers {
  private storage = KeyboardShortcutStorage.getInstance();
  private onShortcutChange?: (shortcut: string) => boolean;
  private onAutoLaunchChange?: (enabled: boolean) => void;
  private mainWindow?: BrowserWindow;

  constructor(
    onShortcutChange?: (shortcut: string) => boolean,
    onAutoLaunchChange?: (enabled: boolean) => void,
    mainWindow?: BrowserWindow,
  ) {
    this.onShortcutChange = onShortcutChange;
    this.onAutoLaunchChange = onAutoLaunchChange;
    this.mainWindow = mainWindow;

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
      // Try to register the shortcut first
      const registered = this.onShortcutChange?.(shortcut);

      if (registered === false) {
        // Registration failed, don't save to storage
        return {
          success: false,
          error: `Failed to register shortcut "${shortcut}". It may be reserved by the OS or another application. Try a different key combination.`,
        };
      }

      // Registration succeeded, save to storage
      await this.storage.setRecordShortcut(shortcut);
      
      // Notify renderer of the change
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        console.log("[KeyboardShortcut] Sending keyboard-shortcut-changed event with:", shortcut);
        this.mainWindow.webContents.send("keyboard-shortcut-changed", shortcut);
      } else {
        console.log("[KeyboardShortcut] Cannot send event - mainWindow not available");
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
      this.onAutoLaunchChange?.(enabled);
      return { success: true };
    } catch (error) {
      console.error("Failed to set auto launch:", error);
      throw error;
    }
  }
}
