import { normalizeYouTubeUrl } from "../../utils/youtube-url-utils";
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

/**
 * Minimal slice of ShaveService that {@link applyVideoMetadataPersistence} depends on, so the
 * wiring (action -> ShaveService write) can be exercised against an in-memory fake.
 */
export interface VideoMetadataShaveStore {
  getShaveById(id: string): { videoEmbedUrl?: string | null } | undefined;
  updateShave(id: string, data: { videoEmbedUrl: string }): unknown;
  attachVideoSourceToShave(
    id: string,
    videoSource: { title: string; sourceUrl: string; durationSeconds: number },
  ): unknown;
}

/**
 * Apply the video-metadata persistence backstop for a shave: read the shave's current embed URL,
 * {@link decideVideoMetadataPersistence decide} what (if anything) to write, and perform the
 * corresponding ShaveService write.
 *
 * Extracted from the IPC handler so the wiring is unit-testable: a successful upload with no
 * existing embed URL MUST call `updateShave({ videoEmbedUrl })`; one whose shave already has an
 * embed URL MUST NOT (no clobber); external origins attach a (downstream-idempotent) source.
 *
 * Returns the action that was applied (useful for assertions/logging). No-ops — returning
 * `{ kind: "none" }` — when there's no shave id, no shave, or nothing to persist.
 */
export function applyVideoMetadataPersistence(
  store: VideoMetadataShaveStore,
  shaveId: string | undefined,
  youtubeResult: VideoUploadResult,
): VideoMetadataPersistenceAction {
  if (!shaveId) {
    return { kind: "none" };
  }

  const existing = store.getShaveById(shaveId);
  if (!existing) {
    return { kind: "none" };
  }

  const action = decideVideoMetadataPersistence(youtubeResult, existing.videoEmbedUrl);

  switch (action.kind) {
    case "attachVideoSource":
      // Idempotent: attachVideoSourceToShave returns early if a source already exists.
      store.attachVideoSourceToShave(shaveId, {
        title: action.title,
        sourceUrl: action.sourceUrl,
        durationSeconds: action.durationSeconds,
      });
      break;
    case "setEmbedUrl":
      store.updateShave(shaveId, { videoEmbedUrl: action.url });
      break;
    case "none":
      break;
  }

  return action;
}

/**
 * The authoritative video fields that must be carried on the portal WorkItemDto so the Tenant
 * view can render a preview.
 *
 * #808: The Tenant-view preview is driven by the portal payload's
 * `uploadedVideoEmbedUrl` / `uploadedVideoUrl` / `uploadedVideoProvider`. Those fields were
 * previously left to the LLM to copy out of the system prompt during structured extraction,
 * which is non-deterministic and intermittently dropped them — exactly the "missing
 * embedUrl/videoFile" symptom #808 reports. We instead derive them deterministically from the
 * same authoritative upload result that the local backstop uses.
 */
export interface PortalVideoFields {
  uploadedVideoProvider: string | null;
  uploadedVideoEmbedUrl: string | null;
  uploadedVideoUrl: string | null;
}

/**
 * Derive the portal WorkItemDto video fields from the authoritative upload/download result.
 *
 * Returns `null` when the result carries no usable URL, signalling the caller to leave whatever
 * the model produced untouched (we never want to overwrite a real value with nulls).
 *
 * When a URL is present we always return all three fields together so the caller can override
 * the model-derived values atomically:
 * - `uploadedVideoUrl` is the canonical watch/page URL (normalized for YouTube, otherwise as-is).
 * - `uploadedVideoEmbedUrl` is an iframe-embeddable URL for recognized providers (YouTube's
 *   `/embed/` form, Vimeo's `player.vimeo.com/video/` form), otherwise `null` — because a plain
 *   provider page URL is NOT iframe-embeddable, and the Tenant view should fall back to a link
 *   rather than render an `<iframe>` whose `src` fails to load.
 * - `uploadedVideoProvider` is `"youtube"`/`"vimeo"` for recognizable URLs, otherwise null.
 */
export function derivePortalVideoFields(
  youtubeResult: VideoUploadResult,
): PortalVideoFields | null {
  const url = youtubeResult.success ? youtubeResult.data?.url : undefined;
  if (!url) {
    return null;
  }

  const normalized = normalizeYouTubeUrl(url);
  const youtubeId = extractYouTubeId(normalized);

  if (youtubeId) {
    return {
      uploadedVideoProvider: "youtube",
      uploadedVideoUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      uploadedVideoEmbedUrl: `https://www.youtube.com/embed/${youtubeId}`,
    };
  }

  const vimeoEmbedUrl = deriveVimeoEmbedUrl(url);
  if (vimeoEmbedUrl) {
    return {
      uploadedVideoProvider: "vimeo",
      uploadedVideoUrl: url,
      uploadedVideoEmbedUrl: vimeoEmbedUrl,
    };
  }

  // Unrecognized provider: carry the page URL deterministically, but we can't synthesize an
  // iframe-embeddable form, so leave the embed URL null (the Tenant view falls back to a link
  // instead of rendering an <iframe> whose src would fail to load) and the provider unknown.
  return {
    uploadedVideoProvider: null,
    uploadedVideoUrl: url,
    uploadedVideoEmbedUrl: null,
  };
}

/**
 * Resolves the iframe-embeddable Vimeo player URL from a Vimeo page URL, else null.
 *
 * A plain `vimeo.com/<id>` page URL is NOT iframe-embeddable; Vimeo's embeddable form is
 * `https://player.vimeo.com/video/<id>`. Unlisted videos carry a privacy hash as the second
 * path segment (`vimeo.com/<id>/<hash>`) which must be forwarded as the `h` query param so the
 * player will load them. We only synthesize from a numeric video id we recognize.
 *
 * Examples:
 * - https://vimeo.com/123456            -> https://player.vimeo.com/video/123456
 * - https://vimeo.com/123456/ab12cd34ef -> https://player.vimeo.com/video/123456?h=ab12cd34ef
 * - https://player.vimeo.com/video/123456?h=ab12cd34ef (already embeddable) -> unchanged form
 */
function deriveVimeoEmbedUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  // Already an embeddable player URL: player.vimeo.com/video/<id>[?h=<hash>]
  if (host === "player.vimeo.com") {
    if (segments[0] === "video" && /^\d+$/.test(segments[1] ?? "")) {
      const hash = parsed.searchParams.get("h");
      const base = `https://player.vimeo.com/video/${segments[1]}`;
      return hash ? `${base}?h=${hash}` : base;
    }
    return null;
  }

  if (host !== "vimeo.com") {
    return null;
  }

  // Page URL: vimeo.com/<id>[/<hash>]
  const [videoId, privacyHash] = segments;
  if (!videoId || !/^\d+$/.test(videoId)) {
    return null;
  }

  const base = `https://player.vimeo.com/video/${videoId}`;
  return privacyHash ? `${base}?h=${privacyHash}` : base;
}

/** Extracts the 11-char video id from a normalized `watch?v=ID` YouTube URL, else null. */
function extractYouTubeId(normalizedUrl: string | null): string | null {
  if (!normalizedUrl) return null;
  try {
    const parsed = new URL(normalizedUrl);
    const id = parsed.searchParams.get("v");
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
