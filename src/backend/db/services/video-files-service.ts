import { and, eq } from "drizzle-orm";
import { getDb } from "../client";
import { type CreateVideoData, type UpdateVideoData, type VideoFile, videoFiles } from "../schema";

/**
 * Create a new video file record.
 * Note: better-sqlite3 is synchronous
 */
export function createVideoFile(data: CreateVideoData): VideoFile {
  const result = getDb().insert(videoFiles).values(data).returning().get();
  return result;
}

/**
 * Get a video file by ID
 */
export function getVideoFileById(id: string): VideoFile | undefined {
  return getDb().select().from(videoFiles).where(eq(videoFiles.id, id)).get();
}

/**
 * Find a video file by file name
 */
export function findVideoFileByName(fileName: string): VideoFile | undefined {
  return getDb().select().from(videoFiles).where(eq(videoFiles.fileName, fileName)).get();
}

/**
 * Get video files for a given video source
 */
export function getVideoFilesByVideoSourceId(videoSourceId: string): VideoFile[] {
  return getDb()
    .select()
    .from(videoFiles)
    .where(and(eq(videoFiles.videoSourceId, videoSourceId), eq(videoFiles.isDeleted, false)))
    .all();
}

/**
 * Mark a video file as deleted (soft delete)
 */
export function markVideoFileAsDeleted(id: string): VideoFile | undefined {
  const deletedAt = new Date().toISOString();
  return getDb()
    .update(videoFiles)
    .set({ isDeleted: true, deletedAt })
    .where(eq(videoFiles.id, id))
    .returning()
    .get();
}

/**
 * Update a video file record
 */
export function updateVideoFile(id: string, data: UpdateVideoData): VideoFile | undefined {
  const result = getDb()
    .update(videoFiles)
    .set(data)
    .where(eq(videoFiles.id, id))
    .returning()
    .get();
  return result;
}

/**
 * Delete a video file record
 */
export function deleteVideoFile(id: string): boolean {
  const result = getDb().delete(videoFiles).where(eq(videoFiles.id, id)).run();
  return result.changes > 0;
}
