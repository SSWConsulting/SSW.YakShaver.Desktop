import { join } from "node:path";
import {
  DEFAULT_TELEMETRY_SETTINGS,
  type TelemetrySettings,
} from "../../../shared/types/telemetry";
import { BaseSecureStorage } from "./base-secure-storage";

const TELEMETRY_FILE = "telemetry-settings.enc";

export class TelemetryStorage extends BaseSecureStorage {
  private static instance: TelemetryStorage;
  private cache: TelemetrySettings | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): TelemetryStorage {
    if (!TelemetryStorage.instance) {
      TelemetryStorage.instance = new TelemetryStorage();
    }
    return TelemetryStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, TELEMETRY_FILE);
  }

  private withDefaults(settings?: Partial<TelemetrySettings> | null): TelemetrySettings {
    if (!settings) {
      return { ...DEFAULT_TELEMETRY_SETTINGS };
    }
    return {
      ...DEFAULT_TELEMETRY_SETTINGS,
      ...settings,
    };
  }

  public async getSettingsAsync(): Promise<TelemetrySettings> {
    if (this.cache) {
      return { ...this.cache };
    }

    const stored = await this.decryptAndLoad<TelemetrySettings>(this.getSettingsPath());
    const finalSettings = this.withDefaults(stored);

    this.cache = finalSettings;
    return finalSettings;
  }

  public async updateSettingsAsync(
    partialSettings: Partial<TelemetrySettings>,
  ): Promise<TelemetrySettings> {
    const current = await this.getSettingsAsync();

    const updated: TelemetrySettings = {
      ...current,
      ...partialSettings,
    };

    await this.encryptAndStore(this.getSettingsPath(), updated);
    this.cache = updated;

    return updated;
  }

  public async hasUserMadeDecisionAsync(): Promise<boolean> {
    const settings = await this.getSettingsAsync();
    return settings.consentStatus !== "pending";
  }

  public async isTelemetryEnabledAsync(): Promise<boolean> {
    const settings = await this.getSettingsAsync();
    return settings.consentStatus === "granted";
  }

  public async clearCache(): Promise<void> {
    this.cache = null;
  }
}
