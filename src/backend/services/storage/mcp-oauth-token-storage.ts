import { join } from "node:path";
import type { OAuthTokens } from "@ai-sdk/mcp";
import { BaseSecureStorage } from "./base-secure-storage";

const MCP_OAUTH_TOKENS_FILE = "mcp-oauth-tokens.enc";

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
    const data = await this.decryptAndLoad<StoredShape>(this.getPath());
    return data ?? { tokensByKey: {} };
  }

  private async saveAllAsync(shape: StoredShape): Promise<void> {
    await this.encryptAndStore(this.getPath(), shape);
  }

  async getTokensAsync(tokenKey: string): Promise<OAuthTokens | undefined> {
    const data = await this.loadAllAsync();
    return data.tokensByKey[tokenKey];
  }

  async saveTokensAsync(tokenKey: string, tokens: OAuthTokens): Promise<void> {
    const data = await this.loadAllAsync();
    data.tokensByKey[tokenKey] = tokens;
    await this.saveAllAsync(data);
  }

  async clearTokensAsync(tokenKey: string): Promise<void> {
    const data = await this.loadAllAsync();
    if (!(tokenKey in data.tokensByKey)) return;
    delete data.tokensByKey[tokenKey];
    await this.saveAllAsync(data);
  }
}
