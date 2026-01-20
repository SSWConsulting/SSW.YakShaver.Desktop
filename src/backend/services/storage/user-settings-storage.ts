import { join } from "node:path";
import {
  DEFAULT_USER_SETTINGS,
  type PartialUserSettings,
  type UserSettings,
} from "../../../shared/types/user-settings";
import { BaseSecureStorage } from "./base-secure-storage";

const SETTINGS_FILE = "user-settings.enc";

export class UserSettingsStorage extends BaseSecureStorage {
  private static instance: UserSettingsStorage;
  private cache: UserSettings | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): UserSettingsStorage {
    if (!UserSettingsStorage.instance) {
      UserSettingsStorage.instance = new UserSettingsStorage();
    }
    return UserSettingsStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  private withDefaults(settings?: Partial<UserSettings> | null): UserSettings {
    if (!settings) {
      return { ...DEFAULT_USER_SETTINGS };
    }
    return {
      ...DEFAULT_USER_SETTINGS,
      ...settings,
    };
  }

  public async getSettingsAsync(): Promise<UserSettings> {
    if (this.cache) {
      return { ...this.cache };
    }

    const stored = await this.decryptAndLoad<UserSettings>(this.getSettingsPath());
    const finalSettings = this.withDefaults(stored);

    this.cache = finalSettings;
    return finalSettings;
  }

  public async updateSettingsAsync(partialSettings: PartialUserSettings): Promise<void> {
    const current = await this.getSettingsAsync();

    const updated: UserSettings = {
      ...current,
      ...partialSettings,
      hotkeys: {
        ...current.hotkeys,
        ...partialSettings.hotkeys,
      },
    };

    await this.encryptAndStore(this.getSettingsPath(), updated);
    this.cache = updated;
  }
}
