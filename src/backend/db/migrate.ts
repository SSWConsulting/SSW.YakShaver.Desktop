import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./client";

function getMigrationsPath(): string {
  // In development: src/backend/db/migrations
  // In production: dist/db/migrations or src/backend/db/migrations (bundled)
  const devPath = path.join(process.cwd(), "src", "backend", "db", "migrations");
  const distPath = path.join(__dirname, "migrations");
  const prodPath = path.join(process.cwd(), "src", "backend", "db", "migrations");

  if (fs.existsSync(distPath) && fs.existsSync(path.join(distPath, "meta", "_journal.json"))) {
    return distPath;
  }
  if (fs.existsSync(devPath) && fs.existsSync(path.join(devPath, "meta", "_journal.json"))) {
    return devPath;
  }
  if (fs.existsSync(prodPath) && fs.existsSync(path.join(prodPath, "meta", "_journal.json"))) {
    return prodPath;
  }

  throw new Error(
    `Could not find migrations folder. Checked:\n- ${distPath}\n- ${devPath}\n- ${prodPath}`,
  );
}

export async function runMigrations(): Promise<void> {
  console.log("[DB] Running database migrations...");
  const migrationsFolder = getMigrationsPath();
  console.log(`[DB] Migrations folder: ${migrationsFolder}`);

  try {
    await migrate(db, {
      migrationsFolder,
    });
    console.log("[DB] ✓ Database migrations completed successfully");

    // Verify tables were created
    const tables = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    console.log(`[DB] ✓ Tables in database: ${tables.map((t: any) => t.name).join(", ")}`);

    // Verify shaves table specifically
    const shavesTable = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='shaves'`,
    );
    if (shavesTable.length > 0) {
      console.log("[DB] ✓ 'shaves' table verified");

      // Get count of records
      const count = db.get(sql`SELECT COUNT(*) as count FROM shaves`);
      console.log(`[DB] Current shave records: ${(count as any)?.count || 0}`);
    } else {
      console.warn("[DB] ⚠ 'shaves' table not found!");
    }
  } catch (error) {
    console.error("[DB] ✗ Failed to run database migrations:", error);
    throw error;
  }
}
