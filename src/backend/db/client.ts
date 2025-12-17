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

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
};

ensureDbDirectory();

const sqlite = new Database(getDbPath());
export const db = drizzle(sqlite, { schema });
