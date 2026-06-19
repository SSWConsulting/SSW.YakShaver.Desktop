import { describe, expect, it } from "vitest";
import { defaultCustomPrompt } from "../services/storage/default-custom-prompt";
import { defaultProjectPrompt } from "../services/workflow/prompts";
import { DUPLICATE_DETECTION_RULES, SHARED_ISSUE_CREATION_RULES } from "./prompts";

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
