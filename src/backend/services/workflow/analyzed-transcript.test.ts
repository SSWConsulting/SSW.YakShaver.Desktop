import { describe, expect, it } from "vitest";
import { AnalyzedTranscriptSchema, readAnalyzedTranscript } from "./analyzed-transcript";

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
});
