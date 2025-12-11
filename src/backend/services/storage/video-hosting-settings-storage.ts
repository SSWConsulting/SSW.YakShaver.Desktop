import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

export type VideoPlatform = "youtube" | "vimeo" | "wistia" | "custom";
export type VideoPrivacy = "public" | "unlisted" | "private";

export interface PlatformCredentials {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  customEndpoint?: string;
}

export interface VideoHostingSettings {
  platform: VideoPlatform;
  credentials: PlatformCredentials;
  defaultPrivacy: VideoPrivacy;
  defaultTags: string[];
  defaultCategory?: string;
  descriptionTemplate?: string;
}

const DEFAULT_SETTINGS: VideoHostingSettings = {
  platform: "youtube",
  credentials: {},
  defaultPrivacy: "unlisted",
  defaultTags: [],
};

const VIDEO_HOSTING_SETTINGS_FILE = "video-hosting-settings.enc";

export class VideoHostingSettingsStorage extends BaseSecureStorage {
  private static instance: VideoHostingSettingsStorage;

  private constructor() {
    super();
  }

  public static getInstance(): VideoHostingSettingsStorage {
    if (!VideoHostingSettingsStorage.instance) {
      VideoHostingSettingsStorage.instance = new VideoHostingSettingsStorage();
    }
    return VideoHostingSettingsStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, VIDEO_HOSTING_SETTINGS_FILE);
  }

  private withDefaults(
    settings?: Partial<VideoHostingSettings> | null,
  ): VideoHostingSettings {
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      credentials: {
        ...DEFAULT_SETTINGS.credentials,
        ...settings.credentials,
      },
    };
  }

  public async getSettingsAsync(): Promise<VideoHostingSettings> {
    const stored = await this.decryptAndLoad<VideoHostingSettings>(this.getSettingsPath());
    return this.withDefaults(stored);
  }

  public async setSettingsAsync(settings: VideoHostingSettings): Promise<void> {
    await this.encryptAndStore(this.getSettingsPath(), settings);
  }

  public async testConnection(): Promise<{
    success: boolean;
    error?: string;
    message?: string;
  }> {
    try {
      const settings = await this.getSettingsAsync();
      
      // Basic validation for credentials based on platform
      if (settings.platform === "youtube") {
        if (!settings.credentials.clientId || !settings.credentials.clientSecret) {
          return {
            success: false,
            error: "YouTube requires Client ID and Client Secret",
          };
        }
      } else if (settings.platform === "vimeo") {
        if (!settings.credentials.apiKey) {
          return {
            success: false,
            error: "Vimeo requires an API Key",
          };
        }
      } else if (settings.platform === "wistia") {
        if (!settings.credentials.apiKey) {
          return {
            success: false,
            error: "Wistia requires an API Key",
          };
        }
      } else if (settings.platform === "custom") {
        if (!settings.credentials.customEndpoint) {
          return {
            success: false,
            error: "Custom platform requires an endpoint URL",
          };
        }
      }

      // For now, just validate that required fields are present
      // Actual API connection testing would require platform-specific implementations
      return {
        success: true,
        message: "Configuration validated successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
