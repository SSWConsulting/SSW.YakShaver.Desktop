import { afterAll } from "vitest";
import { closeTestDb } from "./client";

/**
 * Global test database setup for all tests.
 * This file is configured in vitest.config.ts as the setupFiles entry.
 * Note: Each test file should call getTestDb() to get a fresh database instance.
 * The test database is automatically recreated with forceNew: true in each test.
 */

afterAll(() => {
  closeTestDb();
});
