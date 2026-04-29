import { ENDPOINTS } from "../../shared/config/endpoints";

/**
 * Normalize a YouTube URL into the canonical watch form.
 *
 * Recognized hosts come from `YOUTUBE_VALID_DOMAINS` (per-region env var).
 * The canonical output URL is built from `YOUTUBE_WATCH_URL_BASE`.
 * In the china build both are empty, so this function returns the input unchanged.
 *
 * Supported input shapes (when valid domains are populated):
 *   - host with `?v=VIDEO_ID` query param (standard watch URL)
 *   - short host with `/VIDEO_ID` path
 *   - host with `/embed/VIDEO_ID`, `/v/VIDEO_ID`, `/shorts/VIDEO_ID`, `/live/VIDEO_ID` path
 *
 * @param urlInput - the URL to normalize
 * @returns the canonical watch URL with embedded video ID, or the original input if invalid.
 */
export function normalizeYouTubeUrl(urlInput: string | null | undefined): string | null {
  if (!urlInput) return null;

  const validDomains = ENDPOINTS.youtubeValidDomains;
  const shortHostname = ENDPOINTS.youtubeShortHostname;
  const watchUrlBase = ENDPOINTS.youtubeWatchUrlBase;

  // Empty in builds without YouTube support (e.g. china) — pass through.
  if (validDomains.length === 0 || !watchUrlBase) {
    return urlInput;
  }

  try {
    const url = new URL(urlInput);

    if (!validDomains.includes(url.hostname)) {
      return urlInput;
    }

    let videoId: string | null = null;

    if (shortHostname && url.hostname === shortHostname) {
      // pathname is usually "/VIDEO_ID"
      videoId = url.pathname.slice(1);
    } else {
      if (url.searchParams.has("v")) {
        videoId = url.searchParams.get("v");
      } else {
        const pathSegments = url.pathname.split("/").filter(Boolean);

        // Expected patterns: /embed/ID, /v/ID, /shorts/ID, /live/ID
        if (pathSegments.length >= 2) {
          const [type, id] = pathSegments;
          if (["embed", "v", "shorts", "live"].includes(type)) {
            videoId = id;
          }
        }
      }
    }

    // Validate Video ID — strictly 11 characters: A-Z, a-z, 0-9, - and _
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return `${watchUrlBase}${videoId}`;
    }
  } catch (e) {
    console.warn("[YouTubeUrlUtils] Failed to parse video URL:", urlInput, e);
  }

  return urlInput;
}
