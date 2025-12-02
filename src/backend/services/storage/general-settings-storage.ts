import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

export type ToolApprovalMode = "yolo" | "wait" | "always_ask";

export interface GeneralSettings {
  toolApprovalMode: ToolApprovalMode;
}

const DEFAULT_SETTINGS: GeneralSettings = {
  toolApprovalMode: "always_ask",
};

const GENERAL_SETTINGS_FILE = "general-settings.enc";

export class GeneralSettingsStorage extends BaseSecureStorage {
  private static instance: GeneralSettingsStorage;

  private constructor() {
    super();
  }

  public static getInstance(): GeneralSettingsStorage {
    if (!GeneralSettingsStorage.instance) {
      GeneralSettingsStorage.instance = new GeneralSettingsStorage();
    }
    return GeneralSettingsStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, GENERAL_SETTINGS_FILE);
  }

  private withDefaults(settings?: Partial<GeneralSettings> | null): GeneralSettings {
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
    };
  }

  public async getSettingsAsync(): Promise<GeneralSettings> {
    const stored = await this.decryptAndLoad<GeneralSettings>(this.getSettingsPath());
    return this.withDefaults(stored);
  }

  public async setSettingsAsync(settings: GeneralSettings): Promise<void> {
    await this.encryptAndStore(this.getSettingsPath(), settings);
  }

  public async setToolApprovalModeAsync(mode: ToolApprovalMode): Promise<void> {
    const current = await this.getSettingsAsync();
    await this.setSettingsAsync({ ...current, toolApprovalMode: mode });
  }
}
