import * as crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import {
  OAuthCredentialsStorage,
  type StoredOAuthCredentials,
} from "../services/storage/oauth-credentials-storage";
import { formatErrorMessage } from "../utils/error-utils";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEmbeddedKey(): string | null {
  try {
    const { getCredentialsKey } = require("./credentials-key");
    return getCredentialsKey();
  } catch {
    return null;
  }
}

function deriveKey(secret: string): Buffer {
  const salt = Buffer.from("YakShaver-OAuth-Credentials", "utf8");
  return crypto.pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, "sha256");
}

function decrypt(encryptedBuffer: Buffer, key: Buffer): string {
  const iv = encryptedBuffer.subarray(0, IV_LENGTH);
  const authTag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function getResourcePath(filename: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, filename);
  }
  // Development: look in project root
  return join(process.cwd(), filename);
}

async function loadAppConfig(): Promise<{
  mcpCallbackPort: number;
  mcpAuthTimeoutMs: number;
  githubAppInstallationLink: string;
} | null> {
  try {
    const configPath = getResourcePath("app-config.json");
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function credentialsAlreadyImported(): Promise<boolean> {
  const storage = OAuthCredentialsStorage.getInstance();
  return await storage.hasCredentials();
}

/**
 * Imports encrypted credentials from the bundled file into secure storage.
 * This is a one-time operation on first app launch.
 *
 * @returns true if credentials were imported or already exist, false on error
 */
export async function initializeCredentials(): Promise<boolean> {
  try {
    if (await credentialsAlreadyImported()) {
      return true;
    }

    const encryptionKey = getEmbeddedKey();
    if (!encryptionKey) {
      // Key not available - this is expected in development without the script
      console.warn("[CredentialsLoader] Embedded credentials key not found, falling back to .env");
      return await fallbackToEnv();
    }

    // Try to load encrypted credentials file
    const credentialsPath = getResourcePath("credentials.enc");

    let encryptedBuffer: Buffer;

    try {
      encryptedBuffer = await fs.readFile(credentialsPath);
    } catch (error) {
      // File doesn't exist - this is expected in development without the script
      console.warn("[CredentialsLoader] Encrypted credentials not found, falling back to .env");
      return await fallbackToEnv();
    }

    // Decrypt and import
    const key = deriveKey(encryptionKey);
    let credentials: StoredOAuthCredentials;
    try {
      const decrypted = decrypt(encryptedBuffer, key);
      credentials = JSON.parse(decrypted);
    } catch (err) {
      throw new Error(
        `[CredentialsLoader] Failed to decrypt or parse credentials file: ${formatErrorMessage(err)}`,
      );
    }

    // Store in secure storage
    const storage = OAuthCredentialsStorage.getInstance();
    await storage.storeCredentials(credentials);

    // Load app config into environment for non-sensitive values
    const appConfig = await loadAppConfig();
    if (appConfig) {
      process.env.MCP_CALLBACK_PORT = String(appConfig.mcpCallbackPort);
      process.env.MCP_AUTH_TIMEOUT_MS = String(appConfig.mcpAuthTimeoutMs);
      process.env.GITHUB_APP_INSTALLATION_LINK = appConfig.githubAppInstallationLink;
    }

    return true;
  } catch (error) {
    console.error("[CredentialsLoader] Failed to initialize credentials:", error);
    return false;
  }
}

/**
 * Fallback: Import credentials from .env file (development mode).
 * This maintains backward compatibility during the transition.
 */
async function fallbackToEnv(): Promise<boolean> {
  try {
    const { env } = process;

    const credentials: StoredOAuthCredentials = {};

    if (env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET) {
      credentials.youtube = {
        clientId: env.YOUTUBE_CLIENT_ID,
        clientSecret: env.YOUTUBE_CLIENT_SECRET,
      };
    }

    if (env.MCP_GITHUB_CLIENT_ID && env.MCP_GITHUB_CLIENT_SECRET) {
      credentials.github = {
        clientId: env.MCP_GITHUB_CLIENT_ID,
        clientSecret: env.MCP_GITHUB_CLIENT_SECRET,
      };
    }

    if (Object.keys(credentials).length > 0) {
      const storage = OAuthCredentialsStorage.getInstance();
      await storage.storeCredentials(credentials);
      return true;
    }

    console.warn("[CredentialsLoader] No credentials found in .env");
    return false;
  } catch (error) {
    console.error("[CredentialsLoader] Failed to import from .env:", error);
    return false;
  }
}
