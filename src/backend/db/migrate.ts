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
  console.log("[DB] Running database migrations...");
  const migrationsFolder = getMigrationsPath();
  console.log(`[DB] Migrations folder: ${migrationsFolder}`);

  migrate(db, { migrationsFolder });
  console.log("[DB] ✓ Database migrations completed successfully");

  // Verify tables were created
  const tables = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  console.log(`[DB] ✓ Tables in database: ${tables.map((t) => t.name).join(", ")}`);

  // Verify shaves table specifically
  const shavesTable = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='shaves'`,
  );
  if (shavesTable.length > 0) {
    console.log("[DB] ✓ 'shaves' table verified");
    const count = db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM shaves`);
    console.log(`[DB] Current shave records: ${count?.count || 0}`);
  } else {
    console.warn("[DB] ⚠ 'shaves' table not found!");
  }
}

/**
 * Initialize the database - runs migrations and verifies setup.
 * This is synchronous as better-sqlite3 is a sync driver.
 */
export function initDatabase(): void {
  console.log("\n=== DATABASE INITIALIZATION START ===");
  console.log(`[DB] Environment: ${process.env.NODE_ENV || "production"}`);
  console.log(`[DB] Node version: ${process.version}`);

  try {
    runMigrations();
    console.log("\n[DB] ✓✓✓ DATABASE INITIALIZED SUCCESSFULLY ✓✓✓\n");
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

  console.log("=== DATABASE INITIALIZATION END ===\n");
}
