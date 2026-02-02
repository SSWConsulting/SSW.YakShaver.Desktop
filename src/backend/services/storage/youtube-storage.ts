import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { TokenData } from "../auth/types";
import { BaseSecureStorage } from "./base-secure-storage";

const TOKEN_FILE = "youtube-tokens.enc";

export class YoutubeStorage extends BaseSecureStorage {
  public static readonly TOKENS_UPDATED_EVENT = "youtube-tokens-updated" as const;

  private static instance: YoutubeStorage;
  private events = new EventEmitter();

  private constructor() {
    super();
  }

  public static getInstance(): YoutubeStorage {
    if (!YoutubeStorage.instance) {
      YoutubeStorage.instance = new YoutubeStorage();
    }
    return YoutubeStorage.instance;
  }

  public on(event: typeof YoutubeStorage.TOKENS_UPDATED_EVENT, listener: () => void): void {
    this.events.on(event, listener);
  }

  public off(event: typeof YoutubeStorage.TOKENS_UPDATED_EVENT, listener: () => void): void {
    this.events.off(event, listener);
  }

  private getTokenPath(): string {
    return join(this.storageDir, TOKEN_FILE);
  }

  async storeYouTubeTokens(tokens: TokenData): Promise<void> {
    await this.encryptAndStore(this.getTokenPath(), tokens);
    this.events.emit(YoutubeStorage.TOKENS_UPDATED_EVENT);
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
