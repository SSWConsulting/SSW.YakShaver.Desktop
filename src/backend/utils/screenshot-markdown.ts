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

/** Matches a `### Screenshots` heading line (any heading level), case-insensitive. */
const SCREENSHOTS_HEADING_REGEX = /^\s*#{1,6}\s+screenshots\b/i;

/**
 * Whether `toolName` is a backlog item CREATE/UPDATE tool whose body markdown we should
 * normalise (#834). The decision must be robust across third-party MCP servers
 * (GitHub / Azure DevOps / Jira) whose tool names we don't own, so we do NOT scan for loose
 * keywords (the brittle pattern #833 deliberately moved away from). Instead we match an
 * explicit, anchored allow-list of the create/update tools and exclude anything that is a
 * comment, reply, cache, search, list, get, or read — none of which author a backlog body.
 *
 * Tool names arrive server-prefixed, e.g. `GitHub__create_issue`, `Azure_DevOps__wit_update_work_item`,
 * `Jira__jira_create_issue`. We strip the `<server>__` prefix and match the bare operation name.
 */
export function isBacklogItemMutationTool(toolName: string): boolean {
  // Strip the `<server>__` prefix the orchestrator adds; keep the bare operation name.
  const bare = toolName.includes("__") ? (toolName.split("__").pop() ?? toolName) : toolName;
  const name = bare.trim().toLowerCase();

  // Explicit exclusions: these may contain a backlog noun + a create-ish verb but do NOT author
  // an issue/work-item BODY. Comments/replies carry user-facing text we must not rewrite;
  // cache/search/list/get/read are read-only. Exclude first so e.g. `add_issue_comment`,
  // `update_issue_cache`, `create_issue_comment` never slip through.
  if (/(comment|reply|reaction|cache|search|list|get|read|find|query|delete|close)/.test(name)) {
    return false;
  }

  // Allow-list, anchored on the OBJECT of the operation: a backlog create/update tool ends with
  // the backlog noun it acts on (`create_issue`, `wit_update_work_item`, `jira_create_issue`,
  // `editJiraIssue` -> `editjiraissue`), and contains a create/update verb. Anchoring the noun
  // at the END is what makes this robust without keyword spotting: `add_issue_comment` ends in
  // `comment` and `update_issue_cache` ends in `cache` (both excluded above), while
  // `create_or_update_file` / `create_pull_request` end in `file` / `request` (not backlog nouns).
  const nounAtEnd = /(work[_-]?item|backlog[_-]?item|issue|pbi|ticket|story|task)$/;
  const hasMutationVerb = /(create|update|edit|new|add|file)/.test(name);
  return nounAtEnd.test(name) && hasMutationVerb;
}

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

  // Split on newlines but preserve them so we can faithfully re-join.
  const lines = body.split("\n");
  const survivingIndexByUrl = chooseSurvivingOccurrences(lines);
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
      // Also drop a Figure caption that immediately followed the dropped embed, so we don't
      // leave an orphaned caption behind.
      if (i + 1 < lines.length && FIGURE_CAPTION_REGEX.test(lines[i + 1])) {
        i += 1;
      }
      continue;
    }

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
