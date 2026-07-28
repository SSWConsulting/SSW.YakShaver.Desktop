import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

type ReleaseChannelType = "latest" | "pr";

export interface ReleaseChannel {
  type: ReleaseChannelType;
  channel?: string;
}

export interface CachedGitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body?: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
}

export interface GitHubReleaseCache {
  releases: CachedGitHubRelease[];
  fetchedAt: number;
  etag?: string;
  blockedUntil?: number;
}

const SETTINGS_FILE = "release-channel.enc";
const RELEASE_CACHE_FILE = "release-cache.enc";

const DEFAULT_CHANNEL: ReleaseChannel = {
  type: "latest",
};

export class ReleaseChannelStorage extends BaseSecureStorage {
  private static instance: ReleaseChannelStorage;
  private cache: ReleaseChannel | null = null;
  private releaseCache: GitHubReleaseCache | null | undefined;

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

  private getReleaseCachePath(): string {
    return join(this.storageDir, RELEASE_CACHE_FILE);
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

  async getReleaseCache(): Promise<GitHubReleaseCache | null> {
    if (this.releaseCache !== undefined) {
      return this.releaseCache;
    }

    this.releaseCache = await this.decryptAndLoad<GitHubReleaseCache>(this.getReleaseCachePath());
    return this.releaseCache;
  }

  async setReleaseCache(cache: GitHubReleaseCache): Promise<void> {
    this.releaseCache = cache;
    await this.encryptAndStore(this.getReleaseCachePath(), cache);
  }
}
