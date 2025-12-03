import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

/**
 * Represents OAuth client credentials for a service provider.
 */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Represents the complete structure of all OAuth credentials stored securely.
 */
export interface StoredOAuthCredentials {
  youtube?: OAuthClientCredentials;
  github?: OAuthClientCredentials;
}

/**
 * Configuration values that don't need encryption (non-sensitive).
 */
export interface AppConfig {
  mcpCallbackPort: number;
  mcpAuthTimeoutMs: number;
  githubAppInstallationLink: string;
}

const OAUTH_CREDENTIALS_FILE = "oauth-credentials.enc";

/**
 * Securely stores and retrieves OAuth client credentials using Electron's safeStorage API.
 * This replaces the need to bundle a .env file with production builds.
 *
 * Credentials are encrypted using the OS keychain:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret (GNOME Keyring, etc.)
 */
export class OAuthCredentialsStorage extends BaseSecureStorage {
  private static instance: OAuthCredentialsStorage;

  private constructor() {
    super();
  }

  static getInstance(): OAuthCredentialsStorage {
    OAuthCredentialsStorage.instance ??= new OAuthCredentialsStorage();
    return OAuthCredentialsStorage.instance;
  }

  private getCredentialsFilePath(): string {
    return join(this.storageDir, OAUTH_CREDENTIALS_FILE);
  }

  /**
   * Stores all OAuth credentials securely.
   */
  async storeCredentials(credentials: StoredOAuthCredentials): Promise<void> {
    await this.encryptAndStore(this.getCredentialsFilePath(), credentials);
  }

  /**
   * Retrieves all stored OAuth credentials.
   */
  async getCredentials(): Promise<StoredOAuthCredentials | null> {
    return await this.decryptAndLoad<StoredOAuthCredentials>(this.getCredentialsFilePath());
  }

  /**
   * Gets YouTube OAuth client credentials.
   */
  async getYouTubeCredentials(): Promise<OAuthClientCredentials | null> {
    const credentials = await this.getCredentials();
    return credentials?.youtube ?? null;
  }

  /**
   * Gets GitHub MCP OAuth client credentials.
   */
  async getGitHubCredentials(): Promise<OAuthClientCredentials | null> {
    const credentials = await this.getCredentials();
    return credentials?.github ?? null;
  }

  /**
   * Stores YouTube OAuth client credentials.
   */
  async storeYouTubeCredentials(credentials: OAuthClientCredentials): Promise<void> {
    const existing = (await this.getCredentials()) ?? {};
    await this.storeCredentials({ ...existing, youtube: credentials });
  }

  /**
   * Stores GitHub MCP OAuth client credentials.
   */
  async storeGitHubCredentials(credentials: OAuthClientCredentials): Promise<void> {
    const existing = (await this.getCredentials()) ?? {};
    await this.storeCredentials({ ...existing, github: credentials });
  }

  /**
   * Checks if OAuth credentials are stored.
   */
  async hasCredentials(): Promise<boolean> {
    return await this.fileExists(this.getCredentialsFilePath());
  }

  /**
   * Clears all stored OAuth credentials.
   */
  async clearCredentials(): Promise<void> {
    await this.deleteFile(this.getCredentialsFilePath());
  }
}

/**
 * Gets non-sensitive app configuration values.
 * These can be provided via environment variables or use defaults.
 */
export function getAppConfig(): AppConfig {
  return {
    mcpCallbackPort: Number(process.env.MCP_CALLBACK_PORT ?? 8090),
    mcpAuthTimeoutMs: Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 60000),
    githubAppInstallationLink:
      process.env.GITHUB_APP_INSTALLATION_LINK ??
      "https://github.com/apps/ssw-yakshaver-staging/installations/select_target",
  };
}
