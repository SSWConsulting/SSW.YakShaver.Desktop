import { desc, eq } from "drizzle-orm";
import type { ShaveStatus } from "../../types";
import { db } from "../client";
import { type CreateShaveData, type Shave, shaves, type UpdateShaveData } from "../schema";

/**
 * Create a new shave record.
 * Note: better-sqlite3 is synchronous, so no async/await needed.
 */
export function createShave(data: CreateShaveData): Shave {
  const result = db.insert(shaves).values(data).returning().get();
  return result;
}

/**
 * Get a shave by ID
 */
export function getShaveById(id: string): Shave | undefined {
  return db.select().from(shaves).where(eq(shaves.id, id)).get();
}

/**
 * Get all shaves, ordered by most recent first
 */
export function getAllShaves(): Shave[] {
  return db.select().from(shaves).orderBy(desc(shaves.createdAt)).all();
}

/**
 * Find a shave by video embed URL
 */
export function findShaveByVideoUrl(videoEmbedUrl: string): Shave | undefined {
  return db.select().from(shaves).where(eq(shaves.videoEmbedUrl, videoEmbedUrl)).get();
}

/**
 * Update a shave record
 */
export function updateShave(id: string, data: UpdateShaveData): Shave | undefined {
  const result = db.update(shaves).set(data).where(eq(shaves.id, id)).returning().get();
  return result;
}

/**
 * Update shave status
 */
export function updateShaveStatus(id: string, status: ShaveStatus): Shave | undefined {
  return updateShave(id, { shaveStatus: status });
}

/**
 * Delete a shave record
 */
export function deleteShave(id: string): boolean {
  const result = db.delete(shaves).where(eq(shaves.id, id)).run();
  return result.changes > 0;
}
