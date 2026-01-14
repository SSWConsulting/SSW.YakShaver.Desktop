import { ipcMain } from "electron";
import type { KeyboardShortcutSettings } from "../../shared/types/keyboard-shortcuts";
import { KeyboardShortcutStorage } from "../services/storage/keyboard-shortcut-storage";
import { IPC_CHANNELS } from "./channels";

export class KeyboardShortcutIPCHandlers {
  private storage = KeyboardShortcutStorage.getInstance();
  private onShortcutChange?: (shortcut: string) => void;
  private onAutoLaunchChange?: (enabled: boolean) => void;

  constructor(
    onShortcutChange?: (shortcut: string) => void,
    onAutoLaunchChange?: (enabled: boolean) => void,
  ) {
    this.onShortcutChange = onShortcutChange;
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

  private async setRecordShortcut(shortcut: string): Promise<{ success: boolean }> {
    try {
      await this.storage.setRecordShortcut(shortcut);
      this.onShortcutChange?.(shortcut);
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
