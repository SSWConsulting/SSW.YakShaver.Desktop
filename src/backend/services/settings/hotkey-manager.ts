import type { HotkeyAction, Hotkeys } from "@shared/types/user-settings";
import { type BrowserWindow, globalShortcut } from "electron";
import { IPC_CHANNELS } from "../../ipc/channels";

export interface FailedHotkeyAction {
  action: HotkeyAction;
  keybind: string;
  reason: string;
}

export interface HotkeyRegistrationResult {
  success: boolean;
  failedActions?: FailedHotkeyAction[];
}

export class HotkeyManager {
  private static instance: HotkeyManager;
  private mainWindow: BrowserWindow | null = null;

  private handlers: Record<HotkeyAction, () => void> = {
    startRecording: this.handleStartRecording.bind(this),
  };

  private constructor() {}

  static getInstance(): HotkeyManager {
    if (!HotkeyManager.instance) {
      HotkeyManager.instance = new HotkeyManager();
    }
    return HotkeyManager.instance;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private handleStartRecording(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
      this.mainWindow.webContents.send(IPC_CHANNELS.OPEN_SOURCE_PICKER);
    }
  }

  registerHotkey(
    action: HotkeyAction,
    keybind: string | null,
  ): { success: boolean; error?: string } {
    const handler = this.handlers[action];
    if (!handler) {
      const error = `No handler found for hotkey action: ${action}`;
      console.error(error);
      return { success: false, error };
    }

    if (keybind === null) {
      return { success: true };
    }

    try {
      const success = globalShortcut.register(keybind, handler);
      if (!success) {
        const error = `Hotkey "${keybind}" is already in use by another application`;
        console.error(`Failed to register hotkey: ${action} (${keybind})`);
        return { success: false, error };
      }
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error registering hotkey: ${action}`, error);
      return { success: false, error: errorMsg };
    }
  }

  registerHotkeys(hotkeys: Hotkeys): HotkeyRegistrationResult {
    this.unregisterAll();

    const failedActions: FailedHotkeyAction[] = [];

    for (const action of Object.keys(this.handlers) as HotkeyAction[]) {
      const keybind = hotkeys[action];
      if (keybind) {
        const result = this.registerHotkey(action, keybind);
        if (!result.success) {
          failedActions.push({
            action,
            keybind,
            reason: result.error || "Unknown error",
          });
        }
      }
    }

    return {
      success: failedActions.length === 0,
      failedActions: failedActions.length > 0 ? failedActions : undefined,
    };
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
  }
}
