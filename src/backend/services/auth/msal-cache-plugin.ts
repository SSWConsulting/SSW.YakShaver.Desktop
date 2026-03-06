import { join } from "node:path";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { BaseSecureStorage } from "../storage/base-secure-storage";

const CACHE_FILE = "msal-cache.enc";

class SecureCacheStorage extends BaseSecureStorage {
  // biome-ignore lint/complexity/noUselessConstructor: Visibility change from protected to public
  constructor() {
    super();
  }
  private getCachePath(): string {
    return join(this.storageDir, CACHE_FILE);
  }

  async read(): Promise<string | null> {
    return await this.decryptAndLoad<string>(this.getCachePath());
  }

  async write(data: string): Promise<void> {
    await this.encryptAndStore(this.getCachePath(), data);
  }

  async clear(): Promise<void> {
    await this.deleteFile(this.getCachePath());
  }
}

export class MsalSecureCachePlugin implements ICachePlugin {
  private storage = new SecureCacheStorage();

  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    try {
      const content = await this.storage.read();
      if (content) {
        cacheContext.tokenCache.deserialize(content);
      }
    } catch (error) {
      // If the cache can't be read, clear it and start fresh so auth can proceed.
      console.warn(
        "[MsalSecureCachePlugin] Failed to read MSAL cache. Clearing and starting fresh.",
        error,
      );
      await this.storage.clear().catch(() => {});
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      try {
        const content = cacheContext.tokenCache.serialize();
        await this.storage.write(content);
      } catch (error) {
        // Log but don't throw — a write failure should not break the current auth session.
        console.warn("[MsalSecureCachePlugin] Failed to persist MSAL cache.", error);
      }
    }
  }
}
