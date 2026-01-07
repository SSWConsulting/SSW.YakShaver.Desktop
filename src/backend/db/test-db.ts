import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/**
 * Creates an in-memory SQLite database for testing.
 * This database is shared across all tests within the same test suite.
 */
export function createTestDb() {
  // Create in-memory database
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  // Run migrations to set up schema
  const migrationsFolder = path.join(__dirname, "migrations");
  migrate(db, { migrationsFolder });

  return { db, sqlite };
}

/**
 * Singleton test database instance shared across all tests.
 * Initialize once and reuse for all test files.
 */
let testDbInstance: ReturnType<typeof createTestDb> | null = null;

export function getTestDb() {
  if (!testDbInstance) {
    testDbInstance = createTestDb();
  }
  return testDbInstance.db;
}

/**
 * Close the test database connection.
 * Call this in a global afterAll if needed.
 */
export function closeTestDb() {
  if (testDbInstance) {
    testDbInstance.sqlite.close();
    testDbInstance = null;
  }
}
