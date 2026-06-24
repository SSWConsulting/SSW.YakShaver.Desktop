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

/**
 * Global twin of {@link IMAGE_LINE_REGEX} used to find EVERY image embed on a line, not just the
 * first. Markdown permits multiple inline images on one line; `line.match(IMAGE_LINE_REGEX)` (non
 * -global) would only ever see the first, so a second screenshot on the same line would be neither
 * deduplicated nor captioned (#834).
 */
const IMAGE_LINE_REGEX_GLOBAL = new RegExp(IMAGE_LINE_REGEX.source, "g");

/** Matches a `### Screenshots` heading line (any heading level), case-insensitive. */
const SCREENSHOTS_HEADING_REGEX = /^\s*#{1,6}\s+screenshots\b/i;

/**
 * Whether `toolName` is a backlog item CREATE/UPDATE tool whose body markdown we should
 * normalise (#834). The decision must be robust across third-party MCP servers
 * (GitHub / Azure DevOps / Jira) whose tool names we don't own, so we do NOT scan for loose
 * keywords (the brittle pattern #833 deliberately moved away from). Instead we require BOTH a
 * backlog noun AND a body-authoring mutation verb anywhere in the bare operation name, then
 * exclude the operations that carry one of those words but never author a backlog BODY
 * (comments, sub-issue links, labels, attachments, and read-only ops).
 *
 * Crucially the backlog noun is matched ANYWHERE in the name, not anchored at the end: the
 * official remote GitHub MCP server (api.githubcopilot.com/mcp) consolidated `create_issue`
 * /`update_issue` into a single action-based `issue_write` tool, whose bare name ends in
 * `write` — an end-anchor would silently miss the live tool and the #834 backstop would never
 * run for the configured GitHub server.
 *
 * Tool names arrive server-prefixed, e.g. `GitHub__issue_write`, `GitHub__create_issue`,
 * `Azure_DevOps__wit_update_work_item`, `Jira__jira_create_issue`. We strip the `<server>__`
 * prefix and match the bare operation name.
 */
export function isBacklogItemMutationTool(toolName: string): boolean {
  // Strip the `<server>__` prefix the orchestrator adds; keep the bare operation name.
  const bare = toolName.includes("__") ? (toolName.split("__").pop() ?? toolName) : toolName;
  const name = bare.trim().toLowerCase();

  // Explicit exclusions FIRST: these may contain a backlog noun + a mutation verb but do NOT
  // author an issue/work-item BODY, so normalising their args would corrupt unrelated content.
  //  - comment/reply/reaction: carry user-facing text we must not rewrite.
  //  - sub_issue: GitHub's `sub_issue_write` manages parent/child links and has no `body`.
  //  - label/assign/milestone/link/relation/attachment: metadata mutations, no body.
  //  - cache/search/list/get/read/find/query/delete/close: read-only or non-body.
  if (
    /(comment|reply|reaction|sub[_-]?issue|label|assign|milestone|link|relation|attachment|cache|search|list|get|read|find|query|delete|close)/.test(
      name,
    )
  ) {
    return false;
  }

  // Require a backlog noun AND a body-authoring mutation verb anywhere in the name. This admits
  // the action-based `issue_write` (GitHub remote), the verb-prefixed `create_issue`
  // /`update_issue` (legacy), `wit_update_work_item` (Azure), `jira_create_issue` and
  // `editjiraissue` (Jira) alike, while `create_or_update_file`/`create_pull_request` lack a
  // backlog noun and `add_issue_comment`/`update_issue_cache`/`sub_issue_write` are excluded above.
  const backlogNoun = /(work[_-]?item|backlog[_-]?item|issue|pbi|ticket|story|task)/;
  const mutationVerb = /(create|update|edit|write|new|add|file)/;
  return backlogNoun.test(name) && mutationVerb.test(name);
}

/** A line that is already a bold Figure caption, e.g. `**Figure: something**`. */
const FIGURE_CAPTION_REGEX = /^\s*\*\*\s*Figure:.*\*\*\s*$/i;

/** True when the line is empty or only whitespace. */
function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim().length === 0;
}

/**
 * Returns the index of the next NON-blank line at or after `from`, skipping blank/whitespace-only
 * lines, or -1 if none. The model commonly separates an image embed from its `**Figure: ...**`
 * caption with a blank line (idiomatic markdown). Looking only at `lines[i + 1]` would miss that
 * caption and synthesise a duplicate one (#834), so caption detection must skip the gap.
 */
function nextNonBlankIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (!isBlank(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Returns the index of the line holding the existing Figure caption for an embed at `imageIndex`,
 * or -1 if the next non-blank line is not a caption. Skips intervening blank lines so a caption the
 * model spaced out from its image (`![...]\n\n**Figure: ...**`) is still recognised (#834).
 */
function existingCaptionIndex(lines: string[], imageIndex: number): number {
  const candidate = nextNonBlankIndex(lines, imageIndex + 1);
  if (candidate !== -1 && FIGURE_CAPTION_REGEX.test(lines[candidate])) {
    return candidate;
  }
  return -1;
}

/**
 * Pre-pass that puts every image embed on its own line. Markdown allows multiple inline images,
 * and/or text wrapped around an image, on a single line; the dedup + caption algorithm assumes one
 * image per line (it inserts a caption as the FOLLOWING line). Normalising embeds onto their own
 * lines first makes that assumption hold so each image is independently deduplicated and captioned,
 * and synthesised captions land directly beneath their image rather than after a multi-image line.
 * Non-image lines are returned unchanged.
 */
function splitInlineImages(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(IMAGE_LINE_REGEX_GLOBAL)];
    // Fast path: no image, OR exactly one image and no other non-whitespace content. Leave the
    // line untouched so we don't disturb indentation or spacing on the common one-image-per-line
    // case (only multi-image / wrapped-text lines need splitting).
    if (
      matches.length === 0 ||
      (matches.length === 1 && line.replace(matches[0][0], "").trim().length === 0)
    ) {
      out.push(line);
      continue;
    }

    let cursor = 0;
    for (const m of matches) {
      const start = m.index ?? 0;
      const before = line.slice(cursor, start);
      if (before.trim().length > 0) {
        out.push(before.replace(/\s+$/, ""));
      }
      out.push(m[0]);
      cursor = start + m[0].length;
    }
    const after = line.slice(cursor);
    if (after.trim().length > 0) {
      out.push(after.replace(/^\s+/, ""));
    }
  }
  return out;
}

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
 * Returns, for each duplicated image URL, the line index of the occurrence that should
 * SURVIVE deduplication. The prompt (constants/prompts.ts rule 8) steers the model to place
 * the single captioned screenshot inside the conventional "### Screenshots" section (which
 * the bug template puts near the bottom of the body). So when the same URL is embedded both
 * by a stray top-of-body line AND inside the "### Screenshots" section, we must keep the
 * Screenshots-section copy — otherwise the guard would empty the section and contradict the
 * very prompt it backstops. When no occurrence is in a Screenshots section we keep the first,
 * preserving the previous behaviour.
 */
function chooseSurvivingOccurrences(lines: string[]): Map<string, number> {
  let inScreenshotsSection = false;
  // url -> { first index seen, first index inside a Screenshots section (if any) }
  const firstByUrl = new Map<string, number>();
  const screenshotsByUrl = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#{1,6}\s/.test(line)) {
      // Entering a heading resets the section; only "### Screenshots" turns the flag on.
      inScreenshotsSection = SCREENSHOTS_HEADING_REGEX.test(line);
      continue;
    }
    const match = line.match(IMAGE_LINE_REGEX);
    if (!match?.groups) {
      continue;
    }
    const url = match.groups.url;
    if (!firstByUrl.has(url)) {
      firstByUrl.set(url, i);
    }
    if (inScreenshotsSection && !screenshotsByUrl.has(url)) {
      screenshotsByUrl.set(url, i);
    }
  }

  const survivor = new Map<string, number>();
  for (const [url, firstIdx] of firstByUrl) {
    // Prefer the Screenshots-section occurrence when one exists; else keep the first.
    survivor.set(url, screenshotsByUrl.get(url) ?? firstIdx);
  }
  return survivor;
}

/**
 * Collects the Figure caption that immediately follows each DROPPED duplicate embed, keyed by
 * URL, so a rich LLM-authored caption on a discarded occurrence can be carried forward to the
 * surviving embed if that survivor has no caption of its own. The first dropped caption seen
 * for a URL wins (it is typically the top-of-body embed the model captioned descriptively).
 */
function collectDroppedCaptions(
  lines: string[],
  survivingIndexByUrl: Map<string, number>,
): Map<string, string> {
  const dropped = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(IMAGE_LINE_REGEX);
    if (!match?.groups) {
      continue;
    }
    const url = match.groups.url;
    // Only DROPPED occurrences contribute a carry-forward caption.
    if (survivingIndexByUrl.get(url) === i) {
      continue;
    }
    // Skip intervening blank lines so a caption the model spaced out from its embed is collected.
    const captionIdx = existingCaptionIndex(lines, i);
    if (captionIdx !== -1 && !dropped.has(url)) {
      dropped.set(url, lines[captionIdx].trim());
    }
  }
  return dropped;
}

/**
 * Normalises screenshot markdown in an issue/work-item body:
 *  - removes duplicate embeds of the same image URL (keeping the occurrence inside the
 *    "### Screenshots" section when one exists, otherwise the first), and
 *  - ensures every remaining embed is immediately followed by a bold `**Figure: ...**` caption.
 *
 * Non-image content is preserved verbatim, including a now-empty "### Screenshots" section
 * (we only remove the duplicate image line, not the heading).
 */
export function normalizeIssueScreenshots(body: string): string {
  if (!body || !body.includes("![")) {
    return body;
  }

  // Split on newlines but preserve them so we can faithfully re-join. First put every embed on its
  // own line so multiple inline images (or text wrapped around an image) are each independently
  // deduplicated and captioned, and captions land directly beneath their image (#834).
  const lines = splitInlineImages(body.split("\n"));
  const survivingIndexByUrl = chooseSurvivingOccurrences(lines);
  // Captions found on DROPPED duplicate embeds, keyed by URL. When the surviving embed lacks
  // its own caption we reuse a dropped one instead of synthesising a weaker caption from alt
  // text — the LLM-authored caption on a top embed is typically richer than the bare alt text
  // on the "### Screenshots" copy we keep, and discarding it is a quality regression (#834).
  const droppedCaptionByUrl = collectDroppedCaptions(lines, survivingIndexByUrl);
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(IMAGE_LINE_REGEX);

    if (!match?.groups) {
      result.push(line);
      continue;
    }

    const url = match.groups.url;

    // Keep only the chosen surviving occurrence of each URL; drop every other embed.
    if (survivingIndexByUrl.get(url) !== i) {
      // Also drop a Figure caption that followed the dropped embed (even across blank lines), so we
      // don't leave an orphaned caption behind (it is carried forward via droppedCaptionByUrl
      // below). Advance past the caption AND any blank lines between it and the embed.
      const captionIdx = existingCaptionIndex(lines, i);
      if (captionIdx !== -1) {
        i = captionIdx;
      }
      continue;
    }

    result.push(line);

    // Ensure a bold Figure caption follows this embed. Prefer the survivor's own caption; if it
    // has none, carry forward a caption from a dropped duplicate; otherwise synthesise from alt.
    // The existing caption may be separated from the embed by a blank line (idiomatic markdown), so
    // we look past blank lines before deciding a caption is missing (#834).
    const hasCaption = existingCaptionIndex(lines, i) !== -1;
    if (!hasCaption) {
      result.push(droppedCaptionByUrl.get(url) ?? buildFigureCaption(match.groups.alt));
    }
  }

  return result.join("\n");
}
