import { join } from "node:path";
import type { KeyboardShortcutSettings } from "@shared/types/keyboard-shortcuts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../../shared/types/keyboard-shortcuts";
import { BaseSecureStorage } from "./base-secure-storage";

const SETTINGS_FILE = "keyboard-shortcuts.enc";

export class KeyboardShortcutStorage extends BaseSecureStorage {
  private static instance: KeyboardShortcutStorage;
  private cache: KeyboardShortcutSettings | null = null;

  private constructor() {
    super();
  }

  static getInstance(): KeyboardShortcutStorage {
    if (!KeyboardShortcutStorage.instance) {
      KeyboardShortcutStorage.instance = new KeyboardShortcutStorage();
    }
    return KeyboardShortcutStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  private async loadSettings(): Promise<KeyboardShortcutSettings> {
    if (this.cache) {
      return this.cache;
    }

    const data = await this.decryptAndLoad<KeyboardShortcutSettings>(this.getSettingsPath());
    this.cache = data || { ...DEFAULT_KEYBOARD_SHORTCUTS };

    return this.cache;
  }

  private async saveSettings(data: KeyboardShortcutSettings): Promise<void> {
    this.cache = data;
    await this.encryptAndStore(this.getSettingsPath(), data);
  }

  async getSettings(): Promise<KeyboardShortcutSettings> {
    return await this.loadSettings();
  }

  async updateSettings(updates: Partial<KeyboardShortcutSettings>): Promise<void> {
    const currentSettings = await this.loadSettings();
    const newSettings = { ...currentSettings, ...updates };
    await this.saveSettings(newSettings);
  }

  async setRecordShortcut(shortcut: string): Promise<void> {
    await this.updateSettings({ recordShortcut: shortcut });
  }

  async setAutoLaunch(enabled: boolean): Promise<void> {
    await this.updateSettings({ autoLaunchEnabled: enabled });
  }
}
