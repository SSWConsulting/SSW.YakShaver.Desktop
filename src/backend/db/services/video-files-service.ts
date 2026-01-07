import { eq } from "drizzle-orm";
import { db } from "../client";
import { type CreateVideoData, type UpdateVideoData, type VideoFile, videoFiles } from "../schema";

/**
 * Create a new video file record.
 * Note: better-sqlite3 is synchronous
 */
export function createVideoFile(data: CreateVideoData): VideoFile {
  const result = db.insert(videoFiles).values(data).returning().get();
  return result;
}

/**
 * Get a video file by ID
 */
export function getVideoFileById(id: number): VideoFile | undefined {
  return db.select().from(videoFiles).where(eq(videoFiles.id, id)).get();
}

/**
 * Find a video file by file name
 */
export function findVideoFileByName(fileName: string): VideoFile | undefined {
  return db.select().from(videoFiles).where(eq(videoFiles.fileName, fileName)).get();
}

/**
 * Update a video file record
 */
export function updateVideoFile(id: number, data: UpdateVideoData): VideoFile | undefined {
  const result = db.update(videoFiles).set(data).where(eq(videoFiles.id, id)).returning().get();
  return result;
}

/**
 * Delete a video file record
 */
export function deleteVideoFile(id: number): boolean {
  const result = db.delete(videoFiles).where(eq(videoFiles.id, id)).run();
  return result.changes > 0;
}
