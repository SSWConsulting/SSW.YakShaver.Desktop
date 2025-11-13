import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

interface GitHubTokenData {
  token: string;
}

const SETTINGS_FILE = "github-token.enc";

export class GitHubTokenStorage extends BaseSecureStorage {
  private static instance: GitHubTokenStorage;
  private cache: string | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): GitHubTokenStorage {
    if (!GitHubTokenStorage.instance) {
      GitHubTokenStorage.instance = new GitHubTokenStorage();
    }
    return GitHubTokenStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  public async getToken(): Promise<string | undefined> {
    if (this.cache) {
      return this.cache;
    }

    const data = await this.decryptAndLoad<GitHubTokenData>(this.getSettingsPath());
    if (data?.token) {
      this.cache = data.token;
      return this.cache;
    }
    return undefined;
  }

  public async setToken(token: string): Promise<void> {
    this.cache = token;
    await this.encryptAndStore(this.getSettingsPath(), { token });
  }

  public async clearToken(): Promise<void> {
    this.cache = null;
    await this.deleteFile(this.getSettingsPath());
  }

  public async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }
}
