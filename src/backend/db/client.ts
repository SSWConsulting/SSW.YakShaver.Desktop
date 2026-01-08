import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import * as schema from "./schema";

const configureSqlite = (sqliteInstance: Database.Database): void => {
  // Must run after opening connection; ensures cascading deletes work.
  sqliteInstance.pragma("foreign_keys = ON");
};

export const getDbPath = (): string => {
  const databaseFileName = "database.sqlite";
  if (process.env.NODE_ENV === "development") {
    return path.join(process.cwd(), "data", databaseFileName);
  }
  return path.join(app.getPath("userData"), databaseFileName);
};

const ensureDbDirectory = (): void => {
  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
};

const isTestEnv = process.env.VITEST === "true";

let db: ReturnType<typeof drizzle>;

function initializeDbConnection(): void {
  ensureDbDirectory();
  const sqliteInstance = new Database(getDbPath());
  configureSqlite(sqliteInstance);
  db = drizzle(sqliteInstance, { schema });
}

if (!isTestEnv) {
  initializeDbConnection();
}

export { db };
export const isTestEnvironment = isTestEnv;

/**
 * Singleton test database instance shared across all tests. Initialize once and reuse for all test files.
 */
let testDbInstance: { db: ReturnType<typeof drizzle>; sqlite: Database.Database } | null = null;

type CreateTestDbOptions = {
  /** Forces a brand-new :memory: database instead of reusing the cached instance. */
  forceNew?: boolean;
};

/**
 * Creates an in-memory SQLite database for testing.
 * Runs migrations automatically. Call this once before all tests.
 */
export function createTestDb(options: CreateTestDbOptions = {}) {
  const { forceNew = false } = options;

  if (testDbInstance && !forceNew) {
    return testDbInstance;
  }

  if (testDbInstance && forceNew) {
    try {
      testDbInstance.sqlite.close();
    } catch (error) {
      console.warn("Error closing test database:", error);
    }
    testDbInstance = null;
  }

  // Create in-memory database
  const sqlite = new Database(":memory:");
  configureSqlite(sqlite);
  const testDb = drizzle(sqlite, { schema });

  // Run migrations to set up schema
  const migrationsFolder = path.join(__dirname, "migrations");
  migrate(testDb, { migrationsFolder });

  testDbInstance = { db: testDb, sqlite };

  // Update the global db export so service functions use the test database
  db = testDb;

  return testDbInstance;
}

/**
 * Get the existing test database instance.
 * Creates one if it doesn't exist.
 */
export function getTestDb() {
  return createTestDb().db;
}

/**
 * Close the test database connection.
 * Call this in a global afterAll hook.
 */
export function closeTestDb() {
  if (testDbInstance) {
    testDbInstance.sqlite.close();
    testDbInstance = null;
    // Reset the global db to undefined for next test run
    db = null as unknown as ReturnType<typeof drizzle>;
  }
}
