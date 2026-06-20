import { describe, expect, it } from "vitest";
import type { YouTubeSnippetUpdate } from "../auth/types";
import {
  clampTags,
  sanitizeYouTubeSnippet,
  sanitizeYouTubeText,
  YOUTUBE_DESCRIPTION_MAX_LENGTH,
  YOUTUBE_TITLE_MAX_LENGTH,
} from "./youtube-metadata-sanitizer";

describe("sanitizeYouTubeText (#861 — strip the chars YouTube rejects)", () => {
  it("replaces angle brackets (the invalid-description trigger)", () => {
    const out = sanitizeYouTubeText("See issue <#123> and List<string>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("‹#123›");
    expect(out).toContain("List‹string›");
  });

  it("normalises CRLF to LF", () => {
    expect(sanitizeYouTubeText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("keeps tab and newline but strips other control characters", () => {
    const input = `a\tb\nc${String.fromCharCode(0)}${String.fromCharCode(7)}${String.fromCharCode(
      0x1f,
    )}d`;
    expect(sanitizeYouTubeText(input)).toBe("a\tb\nc" + "d");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeYouTubeText("A normal description with emoji 🦬 and URLs https://x.com")).toBe(
      "A normal description with emoji 🦬 and URLs https://x.com",
    );
  });
});

describe("clampTags (#861 — keep total tag length within budget)", () => {
  it("drops whole tags once the 500-char budget is exhausted", () => {
    const long = "a".repeat(120);
    const tags = [long, long, long, long, long]; // 5 * 120 = 600 > 500
    const out = clampTags(tags);
    const total = out.reduce((n, t) => n + t.length, 0);
    expect(total).toBeLessThanOrEqual(500);
    expect(out.length).toBe(4);
  });

  it("sanitizes angle brackets inside tags and drops empties", () => {
    expect(clampTags(["<bad>", "  ", "good"])).toEqual(["‹bad›", "good"]);
  });
});

describe("sanitizeYouTubeSnippet (#861 — total compliance pass)", () => {
  it("sanitizes title + description and truncates to the API limits", () => {
    const snippet: YouTubeSnippetUpdate = {
      title: `<${"t".repeat(YOUTUBE_TITLE_MAX_LENGTH + 50)}>`,
      description: `<desc> ${"d".repeat(YOUTUBE_DESCRIPTION_MAX_LENGTH + 100)}`,
      tags: ["yakshaver"],
      categoryId: "28",
    };

    const out = sanitizeYouTubeSnippet(snippet);

    expect(out.title.length).toBe(YOUTUBE_TITLE_MAX_LENGTH);
    expect(out.title).not.toContain("<");
    expect(out.description.length).toBe(YOUTUBE_DESCRIPTION_MAX_LENGTH);
    expect(out.description).not.toContain(">");
    expect(out.categoryId).toBe("28");
  });

  it("preserves a missing tags field as undefined", () => {
    const out = sanitizeYouTubeSnippet({ title: "t", description: "d" });
    expect(out.tags).toBeUndefined();
  });
});
