import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import * as schema from "./schema";

const getDbPath = (): string => {
  if (process.env.NODE_ENV === "development") {
    return path.join(process.cwd(), "data", "database.sqlite");
  }
  return path.join(app.getPath("userData"), "database.sqlite");
};

const ensureDbDirectory = (): void => {
  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);
  console.log(`[DB] Database path: ${dbPath}`);
  console.log(`[DB] Database directory: ${dbDir}`);

  if (!fs.existsSync(dbDir)) {
    console.log(`[DB] Creating database directory...`);
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`[DB] ✓ Database directory created`);
  } else {
    console.log(`[DB] ✓ Database directory already exists`);
  }
};

ensureDbDirectory();

const dbPath = getDbPath();
const dbExists = fs.existsSync(dbPath);
if (dbExists) {
  console.log(`[DB] ✓ Database file exists at ${dbPath}`);
} else {
  console.log(`[DB] Database file does not exist yet, will be created at ${dbPath}`);
}

const sqlite = new Database(getDbPath());
console.log(`[DB] ✓ SQLite connection established`);

export const db = drizzle(sqlite, { schema });
console.log(`[DB] ✓ Drizzle ORM initialized`);
