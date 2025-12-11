import { join } from "node:path";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { BaseSecureStorage } from "../storage/base-secure-storage";

const CACHE_FILE = "msal-cache.enc";

class SecureCacheStorage extends BaseSecureStorage {
  constructor() { super(); }
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
    const content = await this.storage.read();
    if (content) {
      cacheContext.tokenCache.deserialize(content);
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      const content = cacheContext.tokenCache.serialize();
      await this.storage.write(content);
    }
  }
}
