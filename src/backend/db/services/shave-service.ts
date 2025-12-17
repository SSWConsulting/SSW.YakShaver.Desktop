import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { type NewShave, type Shave, shaves } from "../schema";

/**
 * Create a new shave record
 */
export async function createShave(data: Omit<NewShave, "id">): Promise<Shave> {
  const result = await db.insert(shaves).values(data).returning();
  return result[0];
}

/**
 * Get a shave by ID
 */
export async function getShaveById(id: number): Promise<Shave | undefined> {
  const result = await db.select().from(shaves).where(eq(shaves.id, id));
  return result[0];
}

/**
 * Get all shaves, ordered by most recent first
 */
export async function getAllShaves(): Promise<Shave[]> {
  return db.select().from(shaves).orderBy(desc(shaves.createdAt));
}

/**
 * Update a shave record
 */
export async function updateShave(
  id: number,
  data: Partial<Omit<NewShave, "id">>,
): Promise<Shave | undefined> {
  const result = await db.update(shaves).set(data).where(eq(shaves.id, id)).returning();
  return result[0];
}

/**
 * Update shave status
 */
export async function updateShaveStatus(
  id: number,
  status: "Pending" | "Processing" | "Completed" | "Failed",
): Promise<Shave | undefined> {
  return updateShave(id, { shaveStatus: status });
}

/**
 * Delete a shave record
 */
export async function deleteShave(id: number): Promise<void> {
  await db.delete(shaves).where(eq(shaves.id, id));
}
