import { describe, expect, it } from "vitest";
import { SHARED_ISSUE_CREATION_RULES } from "./prompts";

// Regression guard for #719: "GitHub issue created with ✨ as title instead of
// video title". The issue title is produced by the LLM following
// SHARED_ISSUE_CREATION_RULES. Before the fix, rule 5 only told the model to
// keep the template's fixed emoji prefix (e.g. "✨" / "🐛 Bug -") but never told
// it to substitute the {{ PLACEHOLDER }} parts with a real, video-derived title,
// so the model emitted just the bare emoji as the title and pushed the real
// title into the body. These assertions lock in the corrected instructions.
describe("SHARED_ISSUE_CREATION_RULES — issue title rules (#719)", () => {
  it("instructs the model to replace template placeholders with video-derived content", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/replace EVERY placeholder/i);
    expect(SHARED_ISSUE_CREATION_RULES).toContain("{{ FEATURE NAME }}");
  });

  it("forbids an emoji-only / fixed-words-only title", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/ONLY an emoji/i);
    // The literal sparkle from the bug report must be called out as invalid.
    expect(SHARED_ISSUE_CREATION_RULES).toContain('NEVER just "✨"');
  });

  it("warns against pushing the real title into the body instead of the title field", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/title field/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/into the issue body/i);
  });
});
