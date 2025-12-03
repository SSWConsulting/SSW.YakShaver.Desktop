/**
 * Build-time script to generate an encrypted credentials file for production builds.
 */

import { randomBytes, createCipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development builds)
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
  console.log("📁 Loaded environment variables from .env file\n");
}

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function encrypt(data, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function deriveKey(secret) {
  const salt = Buffer.from("YakShaver-OAuth-Credentials", "utf8");
  return pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, "sha256");
}

/**
 * Generates a random encryption key if none is provided.
 */
function generateEncryptionKey() {
  return randomBytes(32).toString("hex");
}

function main() {
  console.log("🔐 Generating encrypted credentials file...\n");

  // Collect credentials from environment
  const credentials = {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.MCP_GITHUB_CLIENT_ID,
      clientSecret: process.env.MCP_GITHUB_CLIENT_SECRET,
    },
  };

  // Validate required credentials
  const missing = [];
  if (!credentials.youtube.clientId) missing.push("YOUTUBE_CLIENT_ID");
  if (!credentials.youtube.clientSecret) missing.push("YOUTUBE_CLIENT_SECRET");
  if (!credentials.github.clientId) missing.push("MCP_GITHUB_CLIENT_ID");
  if (!credentials.github.clientSecret) missing.push("MCP_GITHUB_CLIENT_SECRET");

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    for (const varName of missing) {
      console.error(`   - ${varName}`);
    }
    process.exit(1);
  }

  // Get or generate encryption key
  let encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    encryptionKey = generateEncryptionKey();
    console.log("⚠️  No CREDENTIALS_ENCRYPTION_KEY provided, generating a new one.");
  }

  const key = deriveKey(encryptionKey);
  const jsonData = JSON.stringify(credentials);
  const encryptedBuffer = encrypt(jsonData, key);
  const outputPath = join(__dirname, "..", "credentials.enc");
  writeFileSync(outputPath, encryptedBuffer);

  const keyTsContent = `
    const _p1 = "${encryptionKey.slice(0, 16)}";
    const _p2 = "${encryptionKey.slice(16, 32)}";
    const _p3 = "${encryptionKey.slice(32, 48)}";
    const _p4 = "${encryptionKey.slice(48)}";

    export function getCredentialsKey(): string {
      return _p1 + _p2 + _p3 + _p4;
    }
  `;

  const keyTsPath = join(__dirname, "..", "src", "backend", "config", "credentials-key.ts");
  writeFileSync(keyTsPath, keyTsContent);

  // Also create a non-sensitive config file for default values
  const appConfig = {
    mcpCallbackPort: Number(process.env.MCP_CALLBACK_PORT ?? 8090),
    mcpAuthTimeoutMs: Number(process.env.MCP_AUTH_TIMEOUT_MS ?? 60000),
    githubAppInstallationLink:
      process.env.GITHUB_APP_INSTALLATION_LINK ??
      "https://github.com/apps/ssw-yakshaver/installations/select_target",
  };

  const configPath = join(__dirname, "..", "app-config.json");
  writeFileSync(configPath, JSON.stringify(appConfig, null, 2));
}

main();
