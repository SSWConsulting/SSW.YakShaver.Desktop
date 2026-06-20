/**
 * Turns a raw YouTube upload error into user-facing copy. In particular it detects the
 * "this Google account has no YouTube channel yet" case (#672), which the YouTube API reports
 * as `youtubeSignupRequired` — previously this surfaced as an opaque failure (or a green tick
 * with no link). Pure + string-based so it can be unit-tested without the Google client.
 */
/**
 * Connect-time copy for the "this Google account has no YouTube channel" case (#672).
 * Surfaced when channel validation fails during the YouTube CONNECTION flow, so the
 * user is told to create a channel up front instead of only discovering it at upload.
 */
export const NO_YOUTUBE_CHANNEL_CONNECT_MESSAGE =
  "This Google account doesn't have a YouTube channel yet. Create one at youtube.com, then reconnect.";

export function describeYouTubeUploadError(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  let haystack = base;
  try {
    haystack += ` ${JSON.stringify(error)}`;
  } catch {
    // non-serialisable error — the base message is enough to match on
  }

  if (/youtubeSignupRequired|not a YouTube user|channelNotFound|no\s+channel/i.test(haystack)) {
    return "Upload failed: this Google account doesn't have a YouTube channel yet. Create one at youtube.com, then reconnect and try again.";
  }
  return base;
}
