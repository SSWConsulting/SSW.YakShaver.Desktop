import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

const STORAGE_DIR = "yakshaver-tokens";

export abstract class BaseSecureStorage {
  protected storageDir: string;

  protected constructor() {
    this.storageDir = join(app.getPath("userData"), STORAGE_DIR);
  }

  protected async ensureStorageDir(): Promise<void> {
    try {
      await fs.access(this.storageDir);
    } catch {
      await fs.mkdir(this.storageDir, { recursive: true });
    }
  }

  protected async encryptAndStore<T>(filePath: string, data: T): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Encryption is not available on this platform");
    }

    await this.ensureStorageDir();

    const dataJson = JSON.stringify(data);
    const encryptedData = safeStorage.encryptString(dataJson);

    await fs.writeFile(filePath, encryptedData);
  }

  protected async decryptAndLoad<T>(filePath: string): Promise<T | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Encryption is not available on this platform");
      }

      const encryptedData = await fs.readFile(filePath);
      const decryptedString = safeStorage.decryptString(encryptedData);

      return JSON.parse(decryptedString) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null; // File doesn't exist
      }

      // Handle decryption errors (e.g. different machine, OS update, or corrupted file)
      // The error message from Electron's safeStorage is usually:
      // "Error while decrypting the ciphertext provided to safeStorage.decryptString."
      const errorMessage = (error as Error).message || "";
      if (errorMessage.includes("Error while decrypting")) {
        console.warn(
          `[BaseSecureStorage] Failed to decrypt ${filePath}. The file might be corrupted or encrypted with a different key. Ignoring file. Error: ${errorMessage}`,
        );
        return null;
      }

      throw error;
    }
  }

  protected async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
