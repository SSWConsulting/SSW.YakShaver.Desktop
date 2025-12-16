import { runMigrations } from "./migrate";

export async function initDatabase(): Promise<void> {
  console.log("\n=== DATABASE INITIALIZATION START ===");
  console.log(`[DB] Environment: ${process.env.NODE_ENV || "production"}`);
  console.log(`[DB] Node version: ${process.version}`);

  try {
    await runMigrations();
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
