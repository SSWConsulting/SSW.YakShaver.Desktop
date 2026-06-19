import type { VideoUploadResult } from "../auth/types";

/**
 * Describes what (if anything) must be written to the shave record to ensure its video
 * metadata (videoEmbedUrl / video source) is persisted from an authoritative upload result.
 *
 * #808: Desktop-recorded shaves intermittently saved without `videoEmbedUrl`/`videoFile`
 * because that write happened only on the UI side in response to a workflow-progress event,
 * which could be missed/coalesced. The backend now uses this decision to write the field
 * directly from the upload result as a backstop.
 */
export type VideoMetadataPersistenceAction =
  | { kind: "none" }
  | { kind: "setEmbedUrl"; url: string }
  | { kind: "attachVideoSource"; title: string; sourceUrl: string; durationSeconds: number };

/**
 * Pure decision for how to persist video metadata onto a shave record.
 *
 * @param youtubeResult The authoritative upload/download result for the video.
 * @param existingEmbedUrl The shave's currently-persisted videoEmbedUrl (null/undefined if unset).
 * @returns The write action to apply, or `{ kind: "none" }` when nothing should change.
 *
 * Rules (mirror the UI listener in useShaveManager so the two paths agree):
 * - No-op unless the upload succeeded and produced a usable URL.
 * - External sources attach a video source row (idempotency is handled downstream by
 *   attachVideoSourceToShave, which no-ops if a source is already linked).
 * - Uploads set `videoEmbedUrl`, but only when the shave doesn't already have one — so this
 *   backstop never clobbers a value already written by the UI or a metadata update.
 */
export function decideVideoMetadataPersistence(
  youtubeResult: VideoUploadResult,
  existingEmbedUrl: string | null | undefined,
): VideoMetadataPersistenceAction {
  if (!youtubeResult.success || !youtubeResult.data?.url) {
    return { kind: "none" };
  }

  const { url, title, duration } = youtubeResult.data;

  if (youtubeResult.origin === "external") {
    return {
      kind: "attachVideoSource",
      title,
      sourceUrl: url,
      // -1 explicitly indicates unknown duration (mirrors the UI path).
      durationSeconds: duration ?? -1,
    };
  }

  // Upload origin: only fill the embed URL when it isn't already set.
  if (existingEmbedUrl) {
    return { kind: "none" };
  }

  return { kind: "setEmbedUrl", url };
}
