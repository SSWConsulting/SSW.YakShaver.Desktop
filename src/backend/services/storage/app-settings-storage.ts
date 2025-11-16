import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

export interface AppSettings {
  enableYoutubeUrlImport: boolean;
}

const SETTINGS_FILE = "app-settings.enc";

const DEFAULT_SETTINGS: AppSettings = {
  enableYoutubeUrlImport: false,
};

export class AppSettingsStorage extends BaseSecureStorage {
  private static instance: AppSettingsStorage;
  private cache: AppSettings | null = null;

  private constructor() {
    super();
  }

  static getInstance(): AppSettingsStorage {
    if (!AppSettingsStorage.instance) {
      AppSettingsStorage.instance = new AppSettingsStorage();
    }
    return AppSettingsStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  private async loadSettings(): Promise<AppSettings> {
    if (this.cache) {
      return this.cache;
    }

    const data = await this.decryptAndLoad<AppSettings>(this.getSettingsPath());
    this.cache = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    return this.cache;
  }

  private async saveSettings(settings: AppSettings): Promise<void> {
    this.cache = settings;
    await this.encryptAndStore(this.getSettingsPath(), settings);
  }

  async getSettings(): Promise<AppSettings> {
    return await this.loadSettings();
  }

  async updateSettings(updates: Partial<AppSettings> = {}): Promise<AppSettings> {
    const current = await this.loadSettings();
    const updated: AppSettings = { ...current, ...updates };
    await this.saveSettings(updated);
    return updated;
  }
}

