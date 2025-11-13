import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

type ReleaseChannelType = "latest" | "tag";

export interface ReleaseChannel {
  type: ReleaseChannelType;
  tag?: string;
}

const SETTINGS_FILE = "release-channel.enc";

const DEFAULT_CHANNEL: ReleaseChannel = {
  type: "latest",
};

export class ReleaseChannelStorage extends BaseSecureStorage {
  private static instance: ReleaseChannelStorage;
  private cache: ReleaseChannel | null = null;

  private constructor() {
    super();
  }

  static getInstance(): ReleaseChannelStorage {
    if (!ReleaseChannelStorage.instance) {
      ReleaseChannelStorage.instance = new ReleaseChannelStorage();
    }
    return ReleaseChannelStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  private async loadSettings(): Promise<ReleaseChannel> {
    if (this.cache) {
      return this.cache;
    }

    const data = await this.decryptAndLoad<ReleaseChannel>(this.getSettingsPath());
    this.cache = data || DEFAULT_CHANNEL;

    return this.cache;
  }

  private async saveSettings(data: ReleaseChannel): Promise<void> {
    this.cache = data;
    await this.encryptAndStore(this.getSettingsPath(), data);
  }

  async getChannel(): Promise<ReleaseChannel> {
    return await this.loadSettings();
  }

  async setChannel(channel: ReleaseChannel): Promise<void> {
    await this.saveSettings(channel);
  }
}
