import type { VideoUploadResult } from "../auth/types";

/**
 * #672: only complete the "Uploading Video" stage when the upload actually
 * succeeded. `uploadVideo()` returns `{ success: false }` (without throwing) when
 * e.g. the Google account has no YouTube channel — previously that still completed
 * the stage, leaving a green tick and no link. Anything that isn't a clear success
 * must fail the stage so the user sees why.
 */
export function uploadSucceeded(result: VideoUploadResult): boolean {
  return result.success === true;
}

/**
 * #672: the message to show when the upload stage fails. Prefer the concrete error
 * surfaced by the client (e.g. the no-channel copy from describeYouTubeUploadError),
 * falling back to a generic message so the stage never fails silently.
 */
export function resolveUploadFailureMessage(result: VideoUploadResult): string {
  return result.error || "Video upload failed";
}

/**
 * #798: the "Updating Metadata" stage only applies to a video we uploaded and own.
 * Returns the YouTube videoId whose metadata should be updated, or `null` when the
 * stage should be skipped — for an external link (a YouTube URL the user may not
 * own) or a failed/absent upload (no videoId). Returning the id (rather than a
 * boolean) lets the caller use it without re-deriving or re-narrowing.
 */
export function metadataVideoIdToUpdate(result: VideoUploadResult): string | null {
  const videoId = result.data?.videoId;
  if (result.origin === "external" || result.success !== true || !videoId) {
    return null;
  }
  return videoId;
}
