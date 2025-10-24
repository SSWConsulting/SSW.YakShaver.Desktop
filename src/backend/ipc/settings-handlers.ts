import { ipcMain } from "electron";
import { SettingsStore } from "../services/storage/settings-store";
import { IPC_CHANNELS } from "./channels";

export class SettingsIPCHandlers {
  private store = SettingsStore.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CUSTOM_PROMPT, () => this.store.getCustomPrompt());
    ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CUSTOM_PROMPT, (_, prompt: string) => {
      this.store.setCustomPrompt(prompt);
      return { success: true };
    });
  }
}
