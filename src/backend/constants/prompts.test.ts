import { describe, expect, it } from "vitest";
import { defaultCustomPrompt } from "../services/storage/default-custom-prompt";
import { defaultProjectPrompt } from "../services/workflow/prompts";
import {
  DUPLICATE_DETECTION_RULES,
  ensureDuplicateDetectionRules,
  SHARED_ISSUE_CREATION_RULES,
  VIDEO_LINK_EMBEDDING_RULES,
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

describe("SHARED_ISSUE_CREATION_RULES — no-template body fallback", () => {
  it("requires Cc, Hi, and the red video link in order when no template exists", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/If no template is found/i);

    const ccIndex = SHARED_ISSUE_CREATION_RULES.indexOf("Cc: <project members>");
    const hiIndex = SHARED_ISSUE_CREATION_RULES.indexOf("Hi <project-associated users>");
    const videoIndex = SHARED_ISSUE_CREATION_RULES.indexOf("[🟥 Watch the video");

    expect(ccIndex).toBeGreaterThan(-1);
    expect(hiIndex).toBeGreaterThan(ccIndex);
    expect(videoIndex).toBeGreaterThan(hiIndex);
  });

  it("uses project-associated users for both Cc and Hi", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /Populate both .*Cc.* and .*Hi.* selected project/i,
    );
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/GitHub username when available/i);
  });

  it("keeps the existing bug and feature fallback sections", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/For bugs/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/For features/i);
    expect(SHARED_ISSUE_CREATION_RULES).toContain("### Pain");
  });
});

describe("VIDEO_LINK_EMBEDDING_RULES — one template-aware video link", () => {
  it("is included in the shared issue-creation rules", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toContain(VIDEO_LINK_EMBEDDING_RULES);
  });

  it("requires exactly one video URL and forbids a separate template-adjacent link", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/MUST appear exactly once/i);
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/fill only that location/i);
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/do NOT add any additional video link/i);
  });

  it("prevents the icon and label from becoming two links to the same URL", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/Do NOT split the icon and label/i);
  });

  it("does not treat a generic video-description or links section as a video-link placeholder", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/Video Description.*NOT an explicit/i);
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/Public Links.*NOT an explicit/i);
  });

  it("requires the canonical red link when no explicit video-link location exists", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toContain("[🟥 Watch the video (<duration>)](<videoLink>)");
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/Otherwise, add exactly one canonical link/i);
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/Do NOT repeat.*bare link/i);
  });

  it("places a fallback canonical link after Cc/Hi and before the first section", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(
      /after the template's Cc\/Hi greeting block and before the first section heading/i,
    );
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(
      /NEVER place.*More Information.*Links.*Environment.*Screenshots/i,
    );
  });

  it("allows repository templates to control video presentation", () => {
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/follow the template/i);
    expect(VIDEO_LINK_EMBEDDING_RULES).toMatch(/icon, label, duration format, or placement/i);
  });
});

describe("SHARED_ISSUE_CREATION_RULES — issue template selection follows user intent", () => {
  it("forbids recording artifacts from influencing the issue type", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /screen recording, uploaded video URL, video transcription, screenshot.*MUST NOT influence/i,
    );
  });

  it("selects the Video template only for an explicit video-management deliverable", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/Select a Video template ONLY/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/publish, upload, prepare, or manage a video/i);
  });

  it("keeps bugs, features, docs, refactors, and generic issues in their intended type", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /report a bug, propose functionality, document work, refactor code, or create a generic\/test issue remains that issue type/i,
    );
  });
});

describe("SHARED_ISSUE_CREATION_RULES — body placeholders are fully resolved", () => {
  it("forbids unresolved double-brace placeholders in the final issue body", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /Replace EVERY double-brace placeholder in the issue body/i,
    );
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(
      /NEVER leave an unresolved.*placeholder in the final body/i,
    );
  });

  it("removes an unavailable placeholder without inventing a person", () => {
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/remove only the placeholder token/i);
    expect(SHARED_ISSUE_CREATION_RULES).toMatch(/do not invent a person or value/i);
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
