import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { OAuthTokens } from "@ai-sdk/mcp";
import { BaseSecureStorage } from "./base-secure-storage";

const MCP_OAUTH_TOKENS_FILE = "mcp-oauth-tokens.enc";
const LEGACY_TOKEN_PREFIX = "mcp.oauth.v1|";
const EXPIRY_BUFFER_MS = 60 * 1000; // 60 seconds buffer

export type StoredOAuthTokens = OAuthTokens & {
  storedAt?: number;
};

type TokenMap = Record<string, StoredOAuthTokens>;

type StoredShape = {
  tokensByKey: TokenMap;
};

export class McpOAuthTokenStorage extends BaseSecureStorage {
  public static readonly TOKENS_UPDATED_EVENT = "tokens-updated";

  private static instance: McpOAuthTokenStorage;
  private static legacyCleanupDone = false;
  private events = new EventEmitter();

  private constructor() {
    super();
  }

  public static getInstance(): McpOAuthTokenStorage {
    if (!McpOAuthTokenStorage.instance) {
      McpOAuthTokenStorage.instance = new McpOAuthTokenStorage();
    }
    return McpOAuthTokenStorage.instance;
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.events.off(event, listener);
  }

  private getPath(): string {
    return join(this.storageDir, MCP_OAUTH_TOKENS_FILE);
  }

  private async loadAllAsync(): Promise<StoredShape> {
    const data = (await this.decryptAndLoad<StoredShape>(this.getPath())) ?? {
      tokensByKey: {},
    };

    if (McpOAuthTokenStorage.legacyCleanupDone) {
      return data;
    }

    const legacyKeys = Object.keys(data.tokensByKey).filter((key) =>
      key.startsWith(LEGACY_TOKEN_PREFIX),
    );

    if (legacyKeys.length === 0) {
      McpOAuthTokenStorage.legacyCleanupDone = true;
      return data;
    }

    const cleaned: StoredShape = { tokensByKey: { ...data.tokensByKey } };
    for (const key of legacyKeys) {
      delete cleaned.tokensByKey[key];
    }

    await this.saveAllAsync(cleaned);
    McpOAuthTokenStorage.legacyCleanupDone = true;
    return cleaned;
  }

  private async saveAllAsync(shape: StoredShape): Promise<void> {
    await this.encryptAndStore(this.getPath(), shape);
  }

  async getTokensAsync(serverId: string): Promise<StoredOAuthTokens | undefined> {
    const data = await this.loadAllAsync();
    return data.tokensByKey[serverId];
  }

  async saveTokensAsync(serverId: string, tokens: OAuthTokens): Promise<void> {
    const data = await this.loadAllAsync();
    data.tokensByKey[serverId] = {
      ...tokens,
      storedAt: Date.now(),
    };
    await this.saveAllAsync(data);
    this.events.emit(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, serverId);
  }

  public isTokenExpired(tokens: StoredOAuthTokens): boolean {
    if (!tokens.expires_in || !tokens.storedAt) {
      return false;
    }

    const expiresAt = tokens.storedAt + tokens.expires_in * 1000;
    return Date.now() > expiresAt - EXPIRY_BUFFER_MS;
  }

  async clearTokensAsync(serverId: string): Promise<void> {
    const data = await this.loadAllAsync();
    if (!(serverId in data.tokensByKey)) return;
    delete data.tokensByKey[serverId];
    await this.saveAllAsync(data);
  }
}
