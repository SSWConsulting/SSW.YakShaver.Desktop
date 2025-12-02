/**
 * Build-time script to generate an encrypted credentials file for production builds.
 *
 * This script is run during CI/CD to create a bundled credentials file that
 * can be safely included in the app resources without exposing secrets in plain text.
 *
 * The file uses AES-256-GCM encryption with a key derived from a build-time secret.
 *
 * Usage in CI:
 *   node scripts/generate-encrypted-credentials.js
 *
 * Required environment variables:
 *   - YOUTUBE_CLIENT_ID
 *   - YOUTUBE_CLIENT_SECRET
 *   - MCP_GITHUB_CLIENT_ID
 *   - MCP_GITHUB_CLIENT_SECRET
 *   - CREDENTIALS_ENCRYPTION_KEY (optional, generated if not provided)
 */

import { randomBytes, createCipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development builds)
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
  console.log("📁 Loaded environment variables from .env file\n");
}

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts data using AES-256-GCM.
 * Returns a buffer containing: IV (16 bytes) + AuthTag (16 bytes) + Encrypted data
 */
function encrypt(data, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine IV + AuthTag + Encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Derives a 256-bit key from the encryption key using PBKDF2.
 */
function deriveKey(secret) {
  // Use a fixed salt for deterministic key derivation
  // The salt is not secret - it just adds entropy to the key derivation
  const salt = Buffer.from("YakShaver-OAuth-Credentials-v1", "utf8");
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
    console.log("   Add this to your GitHub Secrets for consistent builds:\n");
    console.log(`   CREDENTIALS_ENCRYPTION_KEY=${encryptionKey}\n`);
  }

  const key = deriveKey(encryptionKey);
  const jsonData = JSON.stringify(credentials);
  const encryptedBuffer = encrypt(jsonData, key);

  // Write encrypted file
  const outputPath = join(__dirname, "..", "credentials.enc");
  writeFileSync(outputPath, encryptedBuffer);

  console.log(`✅ Encrypted credentials written to: ${outputPath}`);
  console.log(`   File size: ${encryptedBuffer.length} bytes`);

  // Write the key to a separate file for the app to use during first-run
  // This key file should NOT be committed to the repo
  const keyPath = join(__dirname, "..", "credentials.key");
  writeFileSync(keyPath, encryptionKey);
  console.log(`✅ Encryption key written to: ${keyPath}`);
  console.log("   ⚠️  This file should be added to .gitignore\n");

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
  console.log(`✅ App config written to: ${configPath}`);
}

main();
