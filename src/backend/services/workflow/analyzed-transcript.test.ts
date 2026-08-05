import { describe, expect, it } from "vitest";
import {
  AnalyzedTranscriptGenerationSchema,
  AnalyzedTranscriptSchema,
  normalizeAnalyzedTranscript,
  readAnalyzedTranscript,
} from "./analyzed-transcript";

const analyzedTranscript = {
  title: "Login button does not respond",
  taskType: "create_issue",
  detectedLanguage: "en-US",
  formattedContent: "The login button does not respond when clicked.",
  mentionedEntities: ["login button"],
  contextKeywords: ["login"],
  uncertainTerms: [],
};

describe("analyzed transcript", () => {
  it("requires the Shave title before MCP execution", () => {
    expect(AnalyzedTranscriptSchema.parse(analyzedTranscript).title).toBe(analyzedTranscript.title);
    expect(() => AnalyzedTranscriptSchema.parse({ ...analyzedTranscript, title: "" })).toThrow();
    expect(() =>
      AnalyzedTranscriptSchema.parse({ ...analyzedTranscript, title: "x".repeat(91) }),
    ).toThrow();
  });

  it("restores the analyzed content used by reruns", () => {
    expect(readAnalyzedTranscript(JSON.stringify(analyzedTranscript))).toEqual(analyzedTranscript);
    expect(readAnalyzedTranscript("not-json")).toBeUndefined();
  });

  it("truncates an overlong generated title instead of failing the workflow", () => {
    const generated = AnalyzedTranscriptGenerationSchema.parse({
      ...analyzedTranscript,
      title: `  ${"x".repeat(91)}  `,
    });

    const normalized = normalizeAnalyzedTranscript(generated);

    expect(normalized.title).toBe("x".repeat(90));
    expect(AnalyzedTranscriptSchema.parse(normalized)).toEqual(normalized);
  });

  // An emoji costs 1 code point but 2 UTF-16 code units, and `.max()` counts units. Truncating by
  // code points alone leaves 91 units at the boundary, which threw the stage — and house style
  // (#488) prefixes every title with an emoji, so this is the ordinary case.
  it("truncates an emoji-prefixed title without exceeding the code-unit limit", () => {
    const generated = AnalyzedTranscriptGenerationSchema.parse({
      ...analyzedTranscript,
      title: `🐛 ${"x".repeat(120)}`,
    });

    const normalized = normalizeAnalyzedTranscript(generated);

    expect(normalized.title.length).toBeLessThanOrEqual(90);
    expect(normalized.title.startsWith("🐛 ")).toBe(true);
    // The pair survives intact — a naive code-unit slice would leave a lone surrogate here.
    expect(normalized.title).not.toMatch(/[\uD800-\uDFFF]$/);
    expect(() => AnalyzedTranscriptSchema.parse(normalized)).not.toThrow();
  });
});
