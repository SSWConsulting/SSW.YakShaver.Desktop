/**
 * Normalize YouTube URL to extract video ID and create a consistent format.
 * Handles:
 * - Standard: https://www.youtube.com/watch?v=VIDEO_ID
 * - Short: https://youtu.be/VIDEO_ID
 * - Embed: https://www.youtube.com/embed/VIDEO_ID
 * - Shorts: https://www.youtube.com/shorts/VIDEO_ID
 * - Live: https://www.youtube.com/live/VIDEO_ID
 * - Mobile: https://m.youtube.com
 * @param urlInput - The YouTube URL to normalize
 * @returns The normalized URL (https://www.youtube.com/watch?v=ID) or original if invalid
 */
export function normalizeYouTubeUrl(urlInput: string | null | undefined): string | null {
  if (!urlInput) return null;

  try {
    const url = new URL(urlInput);

    // 1. Strict Domain Check
    const validDomains = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];
    if (!validDomains.includes(url.hostname)) {
      return urlInput;
    }

    let videoId: string | null = null;

    // 2. Handle 'youtu.be' (Host-based extraction)
    if (url.hostname === "youtu.be") {
      // pathname is usually "/VIDEO_ID"
      videoId = url.pathname.slice(1);
    }
    // 3. Handle 'youtube.com' variations (Path/Query-based extraction)
    else {
      // Case A: Query param (?v=VIDEO_ID)
      if (url.searchParams.has("v")) {
        videoId = url.searchParams.get("v");
      }
      // Case B: Path-based (/embed/, /v/, /shorts/, /live/)
      else {
        const pathSegments = url.pathname.split("/").filter(Boolean);

        // Expected patterns:
        // /embed/ID
        // /v/ID
        // /shorts/ID
        // /live/ID
        if (pathSegments.length >= 2) {
          const [type, id] = pathSegments;
          if (["embed", "v", "shorts", "live"].includes(type)) {
            videoId = id;
          }
        }
      }
    }

    // 4. Validate Video ID (Strict Regex)
    // YouTube IDs are strictly 11 characters, containing A-Z, a-z, 0-9, - and _
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch (e) {
    // If URL parsing fails, return original
    console.warn("[YouTubeUrlUtils] Failed to parse video URL:", urlInput, e);
  }

  // Return original if it's not a recognizable video URL
  return urlInput;
}
