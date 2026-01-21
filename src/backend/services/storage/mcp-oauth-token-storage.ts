import { join } from "node:path";
import type { OAuthTokens } from "@ai-sdk/mcp";
import { BaseSecureStorage } from "./base-secure-storage";

const MCP_OAUTH_TOKENS_FILE = "mcp-oauth-tokens.enc";
const LEGACY_TOKEN_PREFIX = "mcp.oauth.v1|";

type TokenMap = Record<string, OAuthTokens>;

type StoredShape = {
  tokensByKey: TokenMap;
};

export class McpOAuthTokenStorage extends BaseSecureStorage {
  private static instance: McpOAuthTokenStorage;

  private constructor() {
    super();
  }

  public static getInstance(): McpOAuthTokenStorage {
    if (!McpOAuthTokenStorage.instance) {
      McpOAuthTokenStorage.instance = new McpOAuthTokenStorage();
    }
    return McpOAuthTokenStorage.instance;
  }

  private getPath(): string {
    return join(this.storageDir, MCP_OAUTH_TOKENS_FILE);
  }

  private async loadAllAsync(): Promise<StoredShape> {
    const data = (await this.decryptAndLoad<StoredShape>(this.getPath())) ?? {
      tokensByKey: {},
    };

    const legacyKeys = Object.keys(data.tokensByKey).filter((key) =>
      key.startsWith(LEGACY_TOKEN_PREFIX),
    );

    if (legacyKeys.length === 0) {
      return data;
    }

    const cleaned: StoredShape = { tokensByKey: { ...data.tokensByKey } };
    for (const key of legacyKeys) {
      delete cleaned.tokensByKey[key];
    }

    await this.saveAllAsync(cleaned);
    return cleaned;
  }

  private async saveAllAsync(shape: StoredShape): Promise<void> {
    await this.encryptAndStore(this.getPath(), shape);
  }

  async getTokensAsync(serverId: string): Promise<OAuthTokens | undefined> {
    const data = await this.loadAllAsync();
    return data.tokensByKey[serverId];
  }

  async saveTokensAsync(serverId: string, tokens: OAuthTokens): Promise<void> {
    const data = await this.loadAllAsync();
    data.tokensByKey[serverId] = tokens;
    await this.saveAllAsync(data);
  }

  async clearTokensAsync(serverId: string): Promise<void> {
    const data = await this.loadAllAsync();
    if (!(serverId in data.tokensByKey)) return;
    delete data.tokensByKey[serverId];
    await this.saveAllAsync(data);
  }
}
