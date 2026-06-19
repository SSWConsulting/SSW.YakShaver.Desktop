/**
 * Deterministic post-processing of a generated issue/work-item body so the embedded
 * screenshot markdown is well-formed regardless of how the LLM happened to phrase it.
 *
 * Fixes two recurring symptoms (#834):
 *  1. Missing caption — an embedded screenshot has no bold `**Figure: ...**` caption
 *     beneath it. We synthesise one (from the image alt text) when it's absent.
 *  2. Duplicated screenshots — the same image URL is embedded more than once (typically
 *     once near the top AND again inside a "### Screenshots" section). We keep the FIRST
 *     occurrence and drop every later embed of the same URL.
 *
 * This is intentionally a pure string transform with no LLM/IO so it is deterministic
 * and unit-testable, and it runs as a guard right before the create/update tool executes.
 */

/** Matches a standalone markdown image embed: `![alt](url)` with optional surrounding whitespace. */
const IMAGE_LINE_REGEX = /!\[(?<alt>[^\]]*)\]\((?<url>[^)\s]+)(?<rest>[^)]*)\)/;

/** A line that is already a bold Figure caption, e.g. `**Figure: something**`. */
const FIGURE_CAPTION_REGEX = /^\s*\*\*\s*Figure:.*\*\*\s*$/i;

/**
 * Builds a bold caption line for a screenshot from its alt text.
 * Falls back to a generic caption when the alt text is empty or itself a default placeholder.
 */
export function buildFigureCaption(altText: string): string {
  const cleaned = altText.trim();
  const isPlaceholder =
    cleaned.length === 0 || /^(screenshot|image|screenshot description)$/i.test(cleaned);
  const description = isPlaceholder ? "Screenshot from the recording" : cleaned;
  return `**Figure: ${description}**`;
}

/**
 * Normalises screenshot markdown in an issue/work-item body:
 *  - removes duplicate embeds of the same image URL (keeps the first), and
 *  - ensures every remaining embed is immediately followed by a bold `**Figure: ...**` caption.
 *
 * Non-image content is preserved verbatim, including a now-empty "### Screenshots" section
 * (we only remove the duplicate image line, not the heading).
 */
export function normalizeIssueScreenshots(body: string): string {
  if (!body || !body.includes("![")) {
    return body;
  }

  // Split on newlines but preserve them so we can faithfully re-join.
  const lines = body.split("\n");
  const seenUrls = new Set<string>();
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(IMAGE_LINE_REGEX);

    if (!match?.groups) {
      result.push(line);
      continue;
    }

    const url = match.groups.url;

    // Duplicate embed of an already-seen image — drop this line entirely.
    if (seenUrls.has(url)) {
      // Also drop a Figure caption that immediately followed the duplicate, so we don't
      // leave an orphaned caption behind.
      if (i + 1 < lines.length && FIGURE_CAPTION_REGEX.test(lines[i + 1])) {
        i += 1;
      }
      continue;
    }

    seenUrls.add(url);
    result.push(line);

    // Ensure a bold Figure caption follows this embed.
    const next = lines[i + 1];
    const hasCaption = next !== undefined && FIGURE_CAPTION_REGEX.test(next);
    if (!hasCaption) {
      result.push(buildFigureCaption(match.groups.alt));
    }
  }

  return result.join("\n");
}
