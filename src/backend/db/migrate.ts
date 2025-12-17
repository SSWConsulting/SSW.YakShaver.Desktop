import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client";

function getMigrationsPath(): string {
  const isDev = process.env.NODE_ENV === "development";

  // Development: use project source directly
  if (isDev) {
    const devPath = path.join(process.cwd(), "src", "backend", "db", "migrations");
    if (fs.existsSync(devPath) && fs.existsSync(path.join(devPath, "meta", "_journal.json"))) {
      return devPath;
    }
    throw new Error(`[DB] Development migrations not found at: ${devPath}`);
  }

  // Production: migrations are in extraResources (outside asar)
  const prodPath = path.join(process.resourcesPath, "migrations");
  if (fs.existsSync(prodPath) && fs.existsSync(path.join(prodPath, "meta", "_journal.json"))) {
    return prodPath;
  }

  // Fallback: try inside asar (not recommended but as backup)
  const asarPath = path.join(__dirname, "migrations");
  if (fs.existsSync(asarPath) && fs.existsSync(path.join(asarPath, "meta", "_journal.json"))) {
    console.warn("[DB] Using migrations from asar archive - consider moving to extraResources");
    return asarPath;
  }

  throw new Error(`[DB] Could not find migrations folder. Checked:\n- ${prodPath}\n- ${asarPath}`);
}

export function runMigrations(): void {
  const migrationsFolder = getMigrationsPath();
  migrate(db, { migrationsFolder });

  // Verify shaves table exists
  const shavesTable = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='shaves'`,
  );
  if (shavesTable.length === 0) {
    console.warn("[DB] ⚠ 'shaves' table not found!");
  }
}

/**
 * Initialize the database - runs migrations and verifies setup.
 * This is synchronous as better-sqlite3 is a sync driver.
 */
export function initDatabase(): void {
  try {
    runMigrations();
  } catch (error) {
    console.error("\n[DB] ✗✗✗ DATABASE INITIALIZATION FAILED ✗✗✗");
    console.error("[DB] Error details:", error);
    if (error instanceof Error) {
      console.error("[DB] Error message:", error.message);
      console.error("[DB] Error stack:", error.stack);
    }
    console.error("\n=== DATABASE INITIALIZATION END (FAILED) ===\n");
    throw error;
  }
}
