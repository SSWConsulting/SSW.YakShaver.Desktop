import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { BaseSecureStorage } from "./base-secure-storage";

type ReleaseChannelType = "latest" | "pr";

export interface ReleaseChannel {
  type: ReleaseChannelType;
  channel?: string;
}

export interface CachedRelease {
  prNumber: string;
  tag: string;
  publishedAt: string;
}

export const RELEASE_CACHE_VERSION = 1;

export interface ReleaseCache {
  version: typeof RELEASE_CACHE_VERSION;
  releases: CachedRelease[];
  fetchedAt: number;
  etag?: string;
  blockedUntil?: number;
}

const SETTINGS_FILE = "release-channel.enc";
const RELEASE_CACHE_FILE = "release-cache.json";

const DEFAULT_CHANNEL: ReleaseChannel = {
  type: "latest",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCachedRelease(value: unknown): value is CachedRelease {
  return (
    isRecord(value) &&
    typeof value.prNumber === "string" &&
    typeof value.tag === "string" &&
    typeof value.publishedAt === "string" &&
    Number.isFinite(Date.parse(value.publishedAt))
  );
}

function isReleaseCache(value: unknown): value is ReleaseCache {
  return (
    isRecord(value) &&
    value.version === RELEASE_CACHE_VERSION &&
    Array.isArray(value.releases) &&
    value.releases.every(isCachedRelease) &&
    typeof value.fetchedAt === "number" &&
    Number.isFinite(value.fetchedAt) &&
    (value.etag === undefined || typeof value.etag === "string") &&
    (value.blockedUntil === undefined ||
      (typeof value.blockedUntil === "number" && Number.isFinite(value.blockedUntil)))
  );
}

export class ReleaseChannelStorage extends BaseSecureStorage {
  private static instance: ReleaseChannelStorage;
  private cache: ReleaseChannel | null = null;
  private releaseCache: ReleaseCache | null | undefined;

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
    return join(app.getPath("userData"), RELEASE_CACHE_FILE);
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

  async getReleaseCache(): Promise<ReleaseCache | null> {
    if (this.releaseCache !== undefined) {
      return this.releaseCache;
    }

    try {
      const cacheJson = await fs.readFile(this.getReleaseCachePath(), "utf8");
      const parsedCache: unknown = JSON.parse(cacheJson);
      if (!isRecord(parsedCache) || parsedCache.version !== RELEASE_CACHE_VERSION) {
        this.releaseCache = null;
        return null;
      }
      if (!isReleaseCache(parsedCache)) {
        throw new Error("GitHub release cache has an invalid structure");
      }

      this.releaseCache = parsedCache;
      return this.releaseCache;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.releaseCache = null;
        return null;
      }
      throw error;
    }
  }

  async setReleaseCache(cache: ReleaseCache): Promise<void> {
    this.releaseCache = cache;
    await fs.writeFile(this.getReleaseCachePath(), JSON.stringify(cache), "utf8");
  }
}
