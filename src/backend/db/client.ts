import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import * as schema from "./schema";

const configureSqlite = (sqliteInstance: Database.Database): void => {
  sqliteInstance.pragma("journal_mode = WAL");
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

const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle>;

type DbLifecycleListener = (sqliteInstance: Database.Database) => void;
const lifecycleListeners = new Set<DbLifecycleListener>();

function notifyDbReinitialized(sqliteInstance: Database.Database): void {
  for (const listener of lifecycleListeners) {
    try {
      listener(sqliteInstance);
    } catch (error) {
      console.error("[DB] Error in lifecycle listener", error);
    }
  }
}

type InitializeOptions = {
  emitEvent?: boolean;
};

function initializeDbConnection(options: InitializeOptions = {}): void {
  ensureDbDirectory();
  const sqliteInstance = new Database(getDbPath());
  configureSqlite(sqliteInstance);
  sqlite = sqliteInstance;
  db = drizzle(sqliteInstance, { schema });

  if (options.emitEvent) {
    notifyDbReinitialized(sqliteInstance);
  }
}

if (!isTestEnv) {
  initializeDbConnection();
}

export { db };
export const isTestEnvironment = isTestEnv;

function ensureNotTestEnv(action: string): void {
  if (isTestEnv) {
    throw new Error(`[DB] Cannot ${action} while running tests`);
  }
}

function teardownDbConnection(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
  }
}

export function closeDbConnection(): void {
  ensureNotTestEnv("close the database connection");
  teardownDbConnection();
}

export function reopenDbConnection(): void {
  ensureNotTestEnv("reopen the database connection");
  teardownDbConnection();
  initializeDbConnection({ emitEvent: true });
}

export function onDbReinitialized(listener: DbLifecycleListener): () => void {
  lifecycleListeners.add(listener);
  return () => lifecycleListeners.delete(listener);
}

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
    testDbInstance.sqlite.close();
    testDbInstance = null;
  }

  // Create in-memory database
  const sqlite = new Database(":memory:");
  configureSqlite(sqlite);
  const db = drizzle(sqlite, { schema });

  // Run migrations to set up schema
  const migrationsFolder = path.join(__dirname, "migrations");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  migrate(db, { migrationsFolder });

  testDbInstance = { db, sqlite };
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
  }
}
