import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { TokenData } from "../auth/types";
import { BaseSecureStorage } from "./base-secure-storage";

const TOKEN_FILE = "youtube-tokens.enc";

type YoutubeStorageEvent =
  | typeof YoutubeStorage.TOKENS_UPDATED_EVENT
  | typeof YoutubeStorage.AUTH_FAILED_EVENT;

export class YoutubeStorage extends BaseSecureStorage {
  public static readonly TOKENS_UPDATED_EVENT = "youtube-tokens-updated" as const;
  /**
   * An authorization attempt ended without tokens — the user declined, or the provider/backend
   * failed. Lets a waiter fail fast instead of sitting out its timeout (#965).
   */
  public static readonly AUTH_FAILED_EVENT = "youtube-auth-failed" as const;

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

  public on(event: YoutubeStorageEvent, listener: (attemptId?: string | null) => void): void {
    this.events.on(event, listener);
  }

  public off(event: YoutubeStorageEvent, listener: (attemptId?: string | null) => void): void {
    this.events.off(event, listener);
  }

  /**
   * Signals that YouTube authorization failed, so no tokens are coming.
   *
   * `attemptId` identifies which attempt failed, so a waiter can ignore a callback from an
   * earlier tab rather than being cancelled by it.
   */
  public notifyAuthFailed(attemptId?: string | null): void {
    this.events.emit(YoutubeStorage.AUTH_FAILED_EVENT, attemptId);
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
