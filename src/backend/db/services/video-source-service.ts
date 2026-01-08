import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  type CreateVideoSourceData,
  type UpdateVideoSourceData,
  type VideoSource,
  videoSources,
} from "../schema";

/**
 * Create a new video source record.
 * Note: better-sqlite3 is synchronous, so no async/await needed.
 */
export function createVideoSource(data: CreateVideoSourceData): VideoSource {
  const result = db.insert(videoSources).values(data).returning().get();
  return result;
}

/**
 * Get a video source by ID
 */
export function getVideoSourceById(id: string): VideoSource | undefined {
  return db.select().from(videoSources).where(eq(videoSources.id, id)).get();
}

/**
 * Get all video sources, ordered by most recent first
 */
export function getAllVideoSources(): VideoSource[] {
  return db.select().from(videoSources).orderBy(desc(videoSources.createdAt)).all();
}

/**
 * Find a video source by source URL
 */
export function findVideoSourceByUrl(sourceUrl: string): VideoSource | undefined {
  return db.select().from(videoSources).where(eq(videoSources.sourceUrl, sourceUrl)).get();
}

/**
 * Update a video source record
 */
export function updateVideoSource(
  id: string,
  data: UpdateVideoSourceData,
): VideoSource | undefined {
  const result = db.update(videoSources).set(data).where(eq(videoSources.id, id)).returning().get();
  return result;
}

/**
 * Delete a video source record
 */
export function deleteVideoSource(id: string): boolean {
  const result = db.delete(videoSources).where(eq(videoSources.id, id)).run();
  return result.changes > 0;
}
