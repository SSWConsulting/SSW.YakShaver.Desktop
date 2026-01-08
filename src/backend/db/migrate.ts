import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { closeDbConnection, db, getDbPath, isTestEnvironment, reopenDbConnection } from "./client";
import { DatabaseBackupService } from "./services/backup-service";

const REQUIRED_TABLES = [
  "users",
  "user_identities",
  "video_sources",
  "video_files",
  "prompts",
  "shaves",
  "shave_attempts",
  "process_steps",
  "ai_completions",
  "tool_calls",
  "transcripts",
] as const;

function ensureRequiredTablesExist(): void {
  const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`);
  const existing = new Set(tables.map((table) => table.name));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));

  if (missing.length > 0) {
    throw new Error(`[DB] Missing tables after migrations: ${missing.join(", ")}`);
  }
}

function getMigrationsPath(): string {
  const isDev = process.env.NODE_ENV === "development";

  // Development: use project source directly
  if (isDev) {
    const devPath = path.join(process.cwd(), "src", "backend", "db", "migrations");
    if (fs.existsSync(devPath)) {
      return devPath;
    }
    throw new Error(`[DB] Development migrations not found at: ${devPath}`);
  }

  // Production: migrations are in extraResources (outside asar)
  const resourcesRoot =
    typeof process !== "undefined" && typeof process.resourcesPath === "string"
      ? process.resourcesPath
      : path.join(process.cwd(), "resources");
  const prodPath = path.join(resourcesRoot, "migrations");
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }

  // Fallback: try inside asar (not recommended but as backup)
  const asarPath = path.join(__dirname, "migrations");
  if (fs.existsSync(asarPath)) {
    console.warn("[DB] Using migrations from asar archive - consider moving to extraResources");
    return asarPath;
  }

  throw new Error(`[DB] Could not find migrations folder. Checked:\n- ${prodPath}\n- ${asarPath}`);
}

export function runMigrations(): void {
  const migrationsFolder = getMigrationsPath();

  try {
    console.log("[DB] Running migrations...");
    migrate(db, { migrationsFolder });
    console.log("[DB] Migrations completed successfully");
  } catch (error) {
    console.error("[DB] ✗ Migration failed:", error);
    throw new Error(
      `Database migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  ensureRequiredTablesExist();
}

/**
 * Initialize database with automatic backup and rollback on failure
 * This is the main entry point for database initialization
 */
export async function initDatabase(): Promise<void> {
  const backupService = new DatabaseBackupService();
  const dbPath = getDbPath();
  let backupMetadata: Awaited<ReturnType<typeof backupService.createBackup>> | null = null;

  try {
    // Only create backup if database file exists AND is not empty (skip for fresh installs)
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.size > 0) {
        console.log("[DB] Creating backup before migration...");
        backupMetadata = await backupService.createBackup(dbPath, "pre-migration");

        const isValid = await backupService.verifyBackup(backupMetadata.backupPath);
        if (!isValid) {
          console.warn("[DB] ⚠ Backup verification failed, proceeding without backup");
          backupMetadata = null;
        } else {
          console.log(`[DB] Backup created: ${backupMetadata.backupPath}`);
        }
      } else {
        console.log("[DB] Empty database file detected, skipping backup");
      }
    }

    // Run migrations
    runMigrations();

    console.log("[DB] Database initialized successfully");
    if (backupMetadata) {
      console.log(`[DB] Backup available at: ${backupMetadata.backupPath}`);
      // Cleanup old backups
      await backupService.cleanupOldBackups();
    }
    console.log("\n[DB] === DATABASE INITIALIZATION END (SUCCESS) ===\n");
  } catch (error) {
    console.error("\n[DB] ✗✗✗ DATABASE INITIALIZATION FAILED ✗✗✗");
    console.error("[DB] Error details:", error);

    // Attempt automatic rollback if we have a backup
    if (backupMetadata) {
      try {
        console.log("[DB] Attempting automatic rollback...");

        if (isTestEnvironment) {
          console.warn("[DB] Skipping automatic rollback in test environment");
        } else {
          closeDbConnection();
          await backupService.restoreBackup(backupMetadata.backupPath, dbPath);
          reopenDbConnection();
          console.log("[DB] Database restored to previous state");
        }
      } catch (rollbackError) {
        console.error("[DB] Automatic rollback failed:", rollbackError);
        console.error(`[DB] MANUAL RECOVERY REQUIRED: Restore from ${backupMetadata.backupPath}`);
      }
    }

    console.error("\n=== DATABASE INITIALIZATION END (FAILED) ===\n");
    throw error;
  }
}
