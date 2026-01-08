import { afterAll, beforeEach, vi } from "vitest";
import { closeTestDb, createTestDb } from "./client";

/**
 * Global test database setup for all tests.
 * This file is configured in vitest.config.ts as the setupFiles entry.
 */

let testDbInstance: ReturnType<typeof createTestDb> | null = null;

beforeEach(() => {
  testDbInstance = createTestDb({ forceNew: true });
});

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    get db() {
      return testDbInstance?.db;
    },
    getDbPath: vi.fn(() => ":memory:"),
  };
});

afterAll(() => {
  closeTestDb();
  testDbInstance = null;
});
