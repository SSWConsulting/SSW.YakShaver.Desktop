import { join } from "node:path";
import type { TokenData } from "../auth/types";
import { BaseSecureStorage } from "./base-secure-storage";

const TOKEN_FILE = "youtube-tokens.enc";

export class YoutubeStorage extends BaseSecureStorage {
  private static instance: YoutubeStorage;

  private constructor() {
    super();
  }

  public static getInstance(): YoutubeStorage {
    if (!YoutubeStorage.instance) {
      YoutubeStorage.instance = new YoutubeStorage();
    }
    return YoutubeStorage.instance;
  }

  private getTokenPath(): string {
    return join(this.storageDir, TOKEN_FILE);
  }

  async storeYouTubeTokens(tokens: TokenData): Promise<void> {
    await this.encryptAndStore(this.getTokenPath(), tokens);
  }

  async getYouTubeTokens(): Promise<TokenData | null> {
    return await this.decryptAndLoad<TokenData>(this.getTokenPath());
  }

  async clearYouTubeTokens(): Promise<void> {
    await this.deleteFile(this.getTokenPath());
  }

  async hasYouTubeTokens(): Promise<boolean> {
    return await this.fileExists(this.getTokenPath());
  }
}
