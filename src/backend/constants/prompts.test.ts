import { describe, expect, it } from "vitest";
import { defaultCustomPrompt } from "../services/storage/default-custom-prompt";
import { defaultProjectPrompt } from "../services/workflow/prompts";
import {
  DUPLICATE_DETECTION_RULES,
  ensureDuplicateDetectionRules,
  SHARED_ISSUE_CREATION_RULES,
} from "./prompts";

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

  // Per @tomek-i on #719: when no template exists, fall back to a sensible basic title.
  it("provides a sensible-default fallback when the repo has NO template", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/no template/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/fall back to a sensible default/i);
  });
});

// Regression guard for #544: "PBIs created via the desktop app currently include both an emoji
// (✨ for features, 🐛 for bugs) and an explicit text prefix like 'Feature -' or 'Bug -'". The
// emoji already conveys the semantic type, so the redundant text label must be dropped while the
// emoji itself is kept. These assertions lock in that the generation rules tell the model to keep
// the emoji but drop the "Feature -"/"Bug -" text label, for both the feature and bug flows.
describe("SHARED_ISSUE_CREATION_RULES — drop redundant title text prefix, keep emoji only (#544)", () => {
  it("instructs the model to keep the emoji but drop the redundant text label", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/drop.*redundant fixed text label/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/keep the emoji, remove the text label/i);
  });

  it("explicitly forbids the old 'Feature -' / 'Bug -' prefixed titles", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toContain('NEVER "🐛 Bug -" or "✨ Feature -" as a prefix');
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /still carries the redundant "Feature -"\/"Bug -" text label/i,
    );
  });

  it("gives a worked bug example with the emoji kept and the 'Bug -' label dropped", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toContain(
      "a correct title is `🐛 Login button does not respond to clicks`, NOT `🐛 Bug - Login button does not respond to clicks`",
    );
  });

  it("gives a worked feature example with the emoji kept and the 'Feature -' label dropped", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toContain(
      "NOT `✨ Feature - Dark mode - Add a dark theme toggle to settings`",
    );
  });

  it("still requires the emoji itself to be preserved (only the text label is dropped)", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/Do not omit the emoji or substitute it/i);
  });
});

// Bug #862: a previously created PBI that has since been DELETED in Azure DevOps was still
// treated as a live duplicate. The agent then tried to update the deleted item (rejected by the
// platform) and fell back to creating an incomplete item with only a title + a "duplicate"
// comment. These tests lock in the prompt guidance that excludes deleted items from duplicate
// detection. They are pure string assertions — no DB, so they run deterministically everywhere.
describe("DUPLICATE_DETECTION_RULES — #862 deleted items must not count as duplicates", () => {
  it("instructs the agent to ignore deleted/removed items during duplicate detection", () => {
    const rules = DUPLICATE_DETECTION_RULES.toLowerCase();
    // The core of the bug: a deleted item is NOT a duplicate.
    expect(rules).toContain("deleted");
    expect(rules).toContain("removed");
    expect(rules).toMatch(/does not count as a duplicate/i);
  });

  it("names the Azure DevOps 'Removed' state so removed work items are excluded (AC #1)", () => {
    // AC #1: deleted PBIs are excluded from duplicate detection queries against Azure DevOps.
    expect(DUPLICATE_DETECTION_RULES).toContain("Removed");
    expect(DUPLICATE_DETECTION_RULES).toContain("System.State");
    // A concrete WIQL filter the agent can apply.
    expect(DUPLICATE_DETECTION_RULES).toContain("[System.State] <> 'Removed'");
  });

  it("forbids updating a deleted/removed item (AC #2)", () => {
    // AC #2: YakShaver does not attempt to update PBIs that are marked as deleted.
    expect(DUPLICATE_DETECTION_RULES).toMatch(/never attempt to update.*(deleted|removed)/i);
  });

  it("requires a brand-new fully-populated item when the only match is deleted (AC #3, #4)", () => {
    const rules = DUPLICATE_DETECTION_RULES.toLowerCase();
    // AC #3 + #4: a fresh, fully populated PBI (title, steps to reproduce, acceptance criteria).
    expect(rules).toContain("brand-new");
    expect(rules).toContain("steps to reproduce");
    expect(rules).toContain("acceptance criteria");
  });

  it("forbids adding a duplicate comment when the only match is deleted (AC #5)", () => {
    // AC #5: no duplicate comment is added when the only matching PBI is deleted.
    expect(DUPLICATE_DETECTION_RULES.toLowerCase()).toMatch(/do not add a "?duplicate"? comment/i);
  });

  // Happy-path twin (over-trigger guard): the "ignore deleted" rule must NOT suppress legitimate
  // dedup. A LIVE, non-removed duplicate must STILL be detected and updated. Without an explicit
  // two-sided rule, an LLM could over-apply "exclude removed items" and stop matching live items.
  it("still requires a LIVE (non-removed) duplicate to be detected and updated", () => {
    const rules = DUPLICATE_DETECTION_RULES.toLowerCase();
    // Only deleted/removed items are excluded — a live item is still a duplicate and must be updated.
    expect(rules).toContain("live");
    expect(rules).toMatch(/still.*duplicate/i);
    expect(rules).toMatch(/update it as usual|update it|treat it as the existing duplicate/i);
    // And the rule must warn against using the exclusion to skip legitimate matches.
    expect(rules).toMatch(/do not use this rule to skip|never create a second copy/i);
  });

  it("scopes the WIQL exclusion to removed items only, not other states", () => {
    // The Azure DevOps filter must drop ONLY removed items; live items in other states stay in scope.
    expect(DUPLICATE_DETECTION_RULES).toContain("[System.State] <> 'Removed'");
    expect(DUPLICATE_DETECTION_RULES.toLowerCase()).toMatch(/exclude only removed/i);
  });
});

describe("duplicate-detection guidance is wired into every issue-creation prompt", () => {
  it("is included in the shared issue-creation rules", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toContain(DUPLICATE_DETECTION_RULES);
  });

  it("reaches the default project prompt (remote-style flow)", () => {
    expect(defaultProjectPrompt).toContain(DUPLICATE_DETECTION_RULES);
  });

  it("reaches the default custom prompt (local-style flow)", () => {
    expect(defaultCustomPrompt).toContain(DUPLICATE_DETECTION_RULES);
  });
});

// Bug #862 follow-up: the rules are baked into the DEFAULT prompts, but the runtime only falls
// back to a default when the selected project has no stored prompt. A project (local custom or
// remote portal) that ships its OWN desktopAgentProjectPrompt — including prompts saved before
// this fix — bypassed the default and never carried the guidance. ensureDuplicateDetectionRules
// is the composition-time guarantee that closes that gap for every prompt source.
describe("ensureDuplicateDetectionRules — guarantees the guidance on the finally-resolved prompt", () => {
  it("appends the rules to a non-empty custom/remote prompt that lacks them", () => {
    const customPrompt = "Always file issues in the Acme project. Tag @acme-team.";
    const result = ensureDuplicateDetectionRules(customPrompt);
    expect(result).toContain(customPrompt);
    expect(result).toContain(DUPLICATE_DETECTION_RULES);
  });

  it("is idempotent: a prompt already carrying the rules is returned unchanged", () => {
    // A default/template-derived prompt already embeds the rules — don't duplicate them.
    expect(ensureDuplicateDetectionRules(defaultProjectPrompt)).toBe(defaultProjectPrompt);
    expect(ensureDuplicateDetectionRules(defaultCustomPrompt)).toBe(defaultCustomPrompt);
  });

  it("does not duplicate the rules when applied twice", () => {
    const customPrompt = "Free-form prompt with no duplicate-detection guidance.";
    const once = ensureDuplicateDetectionRules(customPrompt);
    const twice = ensureDuplicateDetectionRules(once);
    expect(twice).toBe(once);
    // Exactly one occurrence of the rules block.
    expect(twice?.split(DUPLICATE_DETECTION_RULES).length).toBe(2);
  });

  it("passes through empty/undefined prompts unchanged (default fallback handles those)", () => {
    expect(ensureDuplicateDetectionRules(undefined)).toBeUndefined();
    expect(ensureDuplicateDetectionRules("")).toBe("");
  });
});
