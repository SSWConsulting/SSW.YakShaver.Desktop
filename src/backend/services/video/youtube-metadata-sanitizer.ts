import type { YouTubeSnippetUpdate } from "../auth/types.js";

/**
 * #861: YouTube's Data API rejects video updates with "invalid video description"
 * (and the equivalent title error) when the snippet contains characters or shapes
 * the API forbids. The two hard rules the API enforces are:
 *
 *  1. Angle brackets `<` / `>` are NOT allowed anywhere in `title` or `description`
 *     — the API treats them as the start of an (illegal) HTML tag and rejects the
 *     whole request. This is the single most common trigger for the #861 failure,
 *     because the AI-generated description happily includes things like
 *     `Issue <#123>`, generic-type signatures (`List<string>`), or comparisons.
 *  2. Length caps: title <= 100 chars, description <= 5000 chars, and the combined
 *     length of all tags <= 500 chars. Over-length values are rejected outright.
 *
 * We sanitize (rather than reject) so the metadata update can still succeed on the
 * exact inputs that previously failed — satisfying #861 AC#4 ("validates or
 * sanitizes video descriptions before sending them to the YouTube API") and AC#6.
 *
 * The replacements are intentionally lossless-in-meaning: `<` -> `‹`, `>` -> `›`
 * (visually similar single-guillemets) so a reader still sees the brackets while
 * the API no longer sees an HTML tag.
 */

// YouTube Data API hard limits.
export const YOUTUBE_TITLE_MAX_LENGTH = 100;
export const YOUTUBE_DESCRIPTION_MAX_LENGTH = 5000;
export const YOUTUBE_TAGS_TOTAL_MAX_LENGTH = 500;

// C0/C1 control characters other than tab (U+0009) and newline (U+000A), which
// the YouTube validator can also reject. Built without literal control chars in
// source so the file stays free of embedded control bytes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching API-rejected control chars to strip them
const CONTROL_CHARS_TO_STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Replace the angle brackets YouTube rejects with visually-similar characters the
 * API accepts, normalise CRLF to LF, and strip control characters (other than tab
 * and newline) that can also trip the validator.
 */
export function sanitizeYouTubeText(value: string): string {
  return value
    .replace(/</g, "‹") // single left-pointing angle quotation mark
    .replace(/>/g, "›") // single right-pointing angle quotation mark
    .replace(/\r\n?/g, "\n") // normalise CRLF/CR to LF (keeps a single LF)
    .replace(CONTROL_CHARS_TO_STRIP, "");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Clamp the combined length of the tag list to YouTube's 500-char budget,
 * dropping whole tags once the budget is exhausted rather than truncating one
 * mid-word (a truncated tag is meaningless and can itself be rejected).
 */
export function clampTags(tags: string[]): string[] {
  const result: string[] = [];
  let total = 0;
  for (const tag of tags) {
    const sanitized = sanitizeYouTubeText(tag).trim();
    if (!sanitized) continue;
    // YouTube counts the tag length; tags containing spaces are quoted, adding 2.
    const cost = sanitized.includes(" ") ? sanitized.length + 2 : sanitized.length;
    if (total + cost > YOUTUBE_TAGS_TOTAL_MAX_LENGTH) break;
    total += cost;
    result.push(sanitized);
  }
  return result;
}

/**
 * #861: sanitize + clamp a snippet so it complies with the YouTube Data API's
 * validation rules before it is sent. Pure and total — every field is brought
 * within the API's accepted shape.
 */
export function sanitizeYouTubeSnippet(snippet: YouTubeSnippetUpdate): YouTubeSnippetUpdate {
  return {
    ...snippet,
    title: truncate(sanitizeYouTubeText(snippet.title), YOUTUBE_TITLE_MAX_LENGTH),
    description: truncate(sanitizeYouTubeText(snippet.description), YOUTUBE_DESCRIPTION_MAX_LENGTH),
    tags: snippet.tags ? clampTags(snippet.tags) : snippet.tags,
  };
}
