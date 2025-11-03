import { ipcMain } from "electron";
import type { CustomPrompt } from "../services/storage/custom-prompt-storage";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { IPC_CHANNELS } from "./channels";

export class SettingsIPCHandlers {
  private store = CustomPromptStorage.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL_PROMPTS, () => this.store.getAllPrompts());
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ACTIVE_PROMPT, () => this.store.getActivePrompt());
    ipcMain.handle(
      IPC_CHANNELS.SETTINGS_ADD_PROMPT,
      (_, prompt: Omit<CustomPrompt, "id" | "createdAt" | "updatedAt">) =>
        this.store.addPrompt(prompt),
    );
    ipcMain.handle(
      IPC_CHANNELS.SETTINGS_UPDATE_PROMPT,
      (_, id: string, updates: Partial<Pick<CustomPrompt, "name" | "description" | "content">>) =>
        this.store.updatePrompt(id, updates),
    );
    ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE_PROMPT, (_, id: string) =>
      this.store.deletePrompt(id),
    );
    ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_ACTIVE_PROMPT, (_, id: string) =>
      this.store.setActivePrompt(id),
    );
  }
}
