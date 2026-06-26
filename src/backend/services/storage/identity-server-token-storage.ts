import { join } from "node:path";
import type { TokenData } from "../auth/types";
import { BaseSecureStorage } from "./base-secure-storage";

const TOKEN_FILE = "identity-server-tokens.enc";

export class IdentityServerTokenStorage extends BaseSecureStorage {
  private static instance: IdentityServerTokenStorage | null = null;

  private constructor() {
    super();
  }

  static getInstance(): IdentityServerTokenStorage {
    if (!IdentityServerTokenStorage.instance) {
      IdentityServerTokenStorage.instance = new IdentityServerTokenStorage();
    }
    return IdentityServerTokenStorage.instance;
  }

  private getTokenPath(): string {
    return join(this.storageDir, TOKEN_FILE);
  }

  async storeTokens(tokens: TokenData): Promise<void> {
    await this.encryptAndStore(this.getTokenPath(), tokens);
  }

  async getTokens(): Promise<TokenData | null> {
    return await this.decryptAndLoad<TokenData>(this.getTokenPath());
  }

  async clearTokens(): Promise<void> {
    await this.deleteFile(this.getTokenPath());
  }

  async hasTokens(): Promise<boolean> {
    return await this.fileExists(this.getTokenPath());
  }
}
