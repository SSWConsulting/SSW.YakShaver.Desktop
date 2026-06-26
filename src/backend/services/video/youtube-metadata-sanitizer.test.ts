import { describe, expect, it } from "vitest";
import type { YouTubeSnippetUpdate } from "../auth/types";
import {
  clampTags,
  sanitizeYouTubeSnippet,
  sanitizeYouTubeText,
  YOUTUBE_DESCRIPTION_MAX_BYTES,
  YOUTUBE_TITLE_MAX_LENGTH,
} from "./youtube-metadata-sanitizer";

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

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
      description: `<desc> ${"d".repeat(YOUTUBE_DESCRIPTION_MAX_BYTES + 100)}`,
      tags: ["yakshaver"],
      categoryId: "28",
    };

    const out = sanitizeYouTubeSnippet(snippet);

    expect(out.title.length).toBe(YOUTUBE_TITLE_MAX_LENGTH);
    expect(out.title).not.toContain("<");
    // ASCII description: 1 byte/char, so the byte cap equals the char count here.
    expect(utf8Bytes(out.description)).toBe(YOUTUBE_DESCRIPTION_MAX_BYTES);
    expect(out.description).not.toContain(">");
    expect(out.categoryId).toBe("28");
  });

  it("caps a multi-byte (emoji) description at the BYTE limit, not the char count", () => {
    // 3000 🦬 = 6000 UTF-16 code units = 12000 UTF-8 bytes — well over the 5000-byte cap.
    const out = sanitizeYouTubeSnippet({
      title: "t",
      description: "🦬".repeat(3000),
    });

    expect(utf8Bytes(out.description)).toBeLessThanOrEqual(YOUTUBE_DESCRIPTION_MAX_BYTES);
    // Each 🦬 is 4 UTF-8 bytes, so 5000 bytes fits floor(5000/4) = 1250 of them.
    expect(out.description).toBe("🦬".repeat(1250));
  });

  it("never splits a surrogate pair / emits a lone surrogate at the byte boundary", () => {
    // Pad with ASCII so an emoji straddles the byte boundary, then assert the
    // truncated description is still well-formed (no lone surrogates).
    const padding = "a".repeat(YOUTUBE_DESCRIPTION_MAX_BYTES - 2);
    const out = sanitizeYouTubeSnippet({
      title: "t",
      description: `${padding}🦬🦬`,
    });

    expect(utf8Bytes(out.description)).toBeLessThanOrEqual(YOUTUBE_DESCRIPTION_MAX_BYTES);
    // The trailing 🦬 (4 bytes) won't fit in the remaining 2 bytes, so it is dropped whole.
    expect(out.description).toBe(padding);
    expect(out.description).not.toMatch(/[\uD800-\uDFFF]/); // no lone surrogate
  });

  it("preserves a missing tags field as undefined", () => {
    const out = sanitizeYouTubeSnippet({ title: "t", description: "d" });
    expect(out.tags).toBeUndefined();
  });
});
