import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { app } from "electron";

/**
 * Database backup and restore service
 * Handles safe migration with automatic backup and rollback capabilities
 */

export interface BackupMetadata {
  originalPath: string;
  backupPath: string;
  timestamp: string;
  schemaVersion: string;
  fileSize: number;
  checksum?: string;
}

export interface DatabaseBackupServiceOptions {
  /**
   * Optional override for the directory where backups are stored.
   * Useful for CLI tools or tests that run before the Electron app boots.
   */
  backupDirectory?: string;
}

const FALLBACK_USER_DATA = path.join(process.cwd(), ".yakshaver");

export class DatabaseBackupService {
  private backupDir: string;
  private maxBackups = 5; // Keep last 5 backups

  constructor(options: DatabaseBackupServiceOptions = {}) {
    this.backupDir = this.resolveBackupDirectory(options.backupDirectory);
    this.ensureBackupDirectory();
  }

  private resolveBackupDirectory(explicitDir?: string): string {
    if (explicitDir) {
      return explicitDir;
    }

    const envDir = process.env.YAKSHAVER_BACKUP_DIR;
    if (envDir) {
      return envDir;
    }

    if (typeof app?.getPath === "function") {
      if (app.isReady()) {
        return path.join(app.getPath("userData"), "db-backups");
      }

      try {
        return path.join(app.getPath("userData"), "db-backups");
      } catch (error) {
        console.warn(
          "[DB] Electron app not ready. Using fallback path for database backups.",
          error,
        );
      }
    }

    const fallbackDir = path.join(FALLBACK_USER_DATA, "db-backups");
    console.warn(`[DB] Falling back to ${fallbackDir} for database backups.`);
    return fallbackDir;
  }

  private ensureBackupDirectory(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create a backup before migration
   * @param dbPath Path to the database file
   * @param schemaVersion Current schema version
   * @returns Backup metadata
   */
  async createBackup(dbPath: string, schemaVersion: string): Promise<BackupMetadata> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `yakshaver_backup_${schemaVersion}_${timestamp}.db`;
    const backupPath = path.join(this.backupDir, backupFileName);

    // Check if source file exists
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }

    // Copy database file
    await fs.promises.copyFile(dbPath, backupPath);

    // Get file size
    const stats = await fs.promises.stat(backupPath);

    const metadata: BackupMetadata = {
      originalPath: dbPath,
      backupPath,
      timestamp,
      schemaVersion,
      fileSize: stats.size,
    };

    // Save metadata
    await this.saveMetadata(metadata);
    return metadata;
  }

  /**
   * Restore database from backup
   * @param backupPath Path to backup file
   * @param targetPath Path where to restore
   */
  async restoreBackup(backupPath: string, targetPath: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Create a temporary backup of current state (in case restore fails)
    const tempBackup = `${targetPath}.restore-temp`;
    if (fs.existsSync(targetPath)) {
      await fs.promises.copyFile(targetPath, tempBackup);
    }

    try {
      // Restore the backup
      await fs.promises.copyFile(backupPath, targetPath);

      // Remove temporary backup
      if (fs.existsSync(tempBackup)) {
        await fs.promises.unlink(tempBackup);
      }
    } catch (error) {
      // If restore failed, restore the temp backup
      if (fs.existsSync(tempBackup)) {
        await fs.promises.copyFile(tempBackup, targetPath);
        await fs.promises.unlink(tempBackup);
      }
      throw error;
    }
  }

  /**
   * Verify backup integrity
   * @param backupPath Path to backup file
   */
  async verifyBackup(backupPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(backupPath);
      if (stats.size === 0) {
        console.error("Backup file is empty");
        return false;
      }

      // Check SQLite header
      const fileHandle = await fs.promises.open(backupPath, "r");
      const buffer = Buffer.alloc(16);

      try {
        const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
        if (bytesRead < buffer.length) {
          console.error("Backup file is too small to be a valid SQLite database");
          return false;
        }
      } finally {
        await fileHandle.close();
      }

      const header = buffer.toString("utf-8");
      if (!header.startsWith("SQLite format 3")) {
        console.error("Backup file is not a valid SQLite database");
        return false;
      }

      // Open database and run integrity check
      let db: Database.Database | null = null;
      try {
        db = new Database(backupPath, { readonly: true });

        // Run SQLite's built-in integrity check
        const result = db.pragma("integrity_check", { simple: true });
        if (result !== "ok") {
          console.error("Database integrity check failed:", result);
          return false;
        }

        // Verify database is not empty by checking for sqlite_master table
        const tables = db
          .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'")
          .get() as { count: number };

        if (tables.count === 0) {
          console.error("Database has no tables");
          return false;
        }

        return true;
      } finally {
        if (db) {
          db.close();
        }
      }
    } catch (error) {
      console.error("Backup verification failed:", error);
      return false;
    }
  }

  /**
   * Save backup metadata to JSON file
   */
  private async saveMetadata(metadata: BackupMetadata): Promise<void> {
    const metadataPath = `${metadata.backupPath}.meta.json`;
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load backup metadata
   */
  async loadMetadata(backupPath: string): Promise<BackupMetadata | null> {
    const metadataPath = `${backupPath}.meta.json`;
    try {
      const content = await fs.promises.readFile(metadataPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const files = await fs.promises.readdir(this.backupDir);
    const backupFiles = files.filter((f) => f.endsWith(".db"));

    const backups: BackupMetadata[] = [];
    for (const file of backupFiles) {
      const backupPath = path.join(this.backupDir, file);
      const metadata = await this.loadMetadata(backupPath);
      if (metadata) {
        backups.push(metadata);
      }
    }

    // Sort by timestamp (newest first)
    return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Clean up old backups (keep only maxBackups)
   */
  async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();

    if (backups.length > this.maxBackups) {
      const toDelete = backups.slice(this.maxBackups);

      for (const backup of toDelete) {
        try {
          await fs.promises.unlink(backup.backupPath);
          await fs.promises.unlink(`${backup.backupPath}.meta.json`);
          console.log(`🗑️  Deleted old backup: ${path.basename(backup.backupPath)}`);
        } catch (error) {
          console.error(`Failed to delete backup: ${backup.backupPath}`, error);
        }
      }
    }
  }

  /**
   * Get backup directory path
   */
  getBackupDirectory(): string {
    return this.backupDir;
  }
}
