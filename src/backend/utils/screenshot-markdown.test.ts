import { describe, expect, it } from "vitest";
import {
  buildFigureCaption,
  isBacklogItemMutationTool,
  normalizeIssueScreenshots,
} from "./screenshot-markdown";

const URL_A =
  "https://sayakshaverproduction.blob.core.windows.net/images/desktop-screenshots/abc.png?sv=2025-05-05&sig=xyz";
const URL_B = "https://example.com/images/second.png?token=123";

/** Escape a string for safe interpolation into a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("normalizeIssueScreenshots — #834 caption + duplicate fixes", () => {
  it("adds a bold Figure caption beneath an uncaptioned screenshot", () => {
    const body = `### Pain\nSomething broke.\n\n![Login screen error](${URL_A})\n\n### Acceptance Criteria\n- [ ] Fix it`;
    const out = normalizeIssueScreenshots(body);

    // Caption present, bold, starts with "Figure:" and uses the alt text.
    expect(out).toContain(`![Login screen error](${URL_A})\n**Figure: Login screen error**`);
    expect(out).toMatch(/\*\*Figure:.*\*\*/);
  });

  it("removes a duplicated screenshot embedded twice (top + Screenshots section)", () => {
    const body = [
      "### Pain",
      "The button is broken.",
      "",
      `![Broken button](${URL_A})`,
      "**Figure: Broken button**",
      "",
      "### Screenshots",
      `![Broken button](${URL_A})`,
    ].join("\n");

    const out = normalizeIssueScreenshots(body);

    // The image URL appears exactly once in the whole body.
    const occurrences = out.split(URL_A).length - 1;
    expect(occurrences).toBe(1);

    // The "### Screenshots" heading is preserved (we only drop the duplicate image line).
    expect(out).toContain("### Screenshots");
  });

  it("drops an orphaned Figure caption that followed the duplicate embed", () => {
    const body = [
      `![Shot](${URL_A})`,
      "**Figure: Shot**",
      "",
      "### Screenshots",
      `![Shot](${URL_A})`,
      "**Figure: Shot**",
    ].join("\n");

    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    // Only one Figure caption remains.
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
  });

  it("handles both bugs together: dedupes AND captions in one pass", () => {
    const body = [
      "### Pain",
      `![Screenshot description](${URL_A})`, // no caption, generic alt
      "",
      "### Screenshots",
      `![Screenshot description](${URL_A})`, // duplicate
    ].join("\n");

    const out = normalizeIssueScreenshots(body);

    // Exactly one embed.
    expect(out.split(URL_A).length - 1).toBe(1);
    // Generic alt text falls back to a sensible caption rather than echoing the placeholder.
    expect(out).toContain("**Figure: Screenshot from the recording**");
  });

  it("keeps distinct screenshots and captions each of them", () => {
    const body = [`![First shot](${URL_A})`, "", `![Second shot](${URL_B})`].join("\n");

    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    expect(out.split(URL_B).length - 1).toBe(1);
    expect(out).toContain("**Figure: First shot**");
    expect(out).toContain("**Figure: Second shot**");
  });

  it("does not double-add a caption when one already exists", () => {
    const body = [`![Login error](${URL_A})`, "**Figure: Login error**"].join("\n");
    const out = normalizeIssueScreenshots(body);
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
    expect(out).toBe(body);
  });

  it("does not double-add a caption when one exists but is separated by a blank line", () => {
    // A blank line between the embed and the model's own caption is idiomatic markdown and not
    // forbidden by the prompt's "on the next line" wording. The guard must still detect the
    // existing caption (skipping the blank line) rather than synthesising a second one (#834).
    const body = [
      `### Screenshots`,
      `![Login crash](${URL_A})`,
      "",
      "**Figure: Login crash**",
    ].join("\n");
    const out = normalizeIssueScreenshots(body);
    // Exactly one caption survives, and the body is unchanged.
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
    expect(out).toBe(body);
  });

  it("does not synthesise a weak caption when a richer one is blank-line-separated", () => {
    // The existing caption is descriptive AND spaced out from the embed. The guard must not add a
    // second, weaker alt-derived caption directly under the image.
    const body = [`![Login crash](${URL_A})`, "", "**Figure: Login crash detail on submit**"].join(
      "\n",
    );
    const out = normalizeIssueScreenshots(body);
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
    expect(out).toContain("**Figure: Login crash detail on submit**");
    expect(out).not.toContain("**Figure: Login crash**");
  });

  it("dedupes a duplicate whose caption is blank-line-separated, carrying it forward", () => {
    // The dropped embed's caption sits a blank line away; it must still be collected (not left
    // orphaned) and carried forward to the caption-less survivor.
    const body = [
      "### Pain",
      `![Login crash](${URL_A})`,
      "",
      "**Figure: Login crash on submit**",
      "",
      "### Screenshots",
      `![Login crash](${URL_A})`,
    ].join("\n");

    const out = normalizeIssueScreenshots(body);
    // Image appears exactly once, exactly one caption, and the rich caption is preserved.
    expect(out.split(URL_A).length - 1).toBe(1);
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
    expect(out).toContain("**Figure: Login crash on submit**");
    // No orphaned caption stranded under "### Pain".
    expect(out).not.toMatch(/### Pain\n+\*\*Figure:/);
  });

  it("captions BOTH images when two distinct images share one line", () => {
    // Multiple inline images on one line is valid markdown; each must be deduped and captioned.
    const body = `Here ![first shot](${URL_A}) and ![second shot](${URL_B}) inline`;
    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    expect(out.split(URL_B).length - 1).toBe(1);
    expect(out).toContain("**Figure: first shot**");
    expect(out).toContain("**Figure: second shot**");
    // Each caption sits directly beneath its own image, not after both.
    expect(out).toMatch(
      new RegExp(`!\\[first shot\\]\\(${escapeRe(URL_A)}\\)\\n\\*\\*Figure: first shot\\*\\*`),
    );
    expect(out).toMatch(
      new RegExp(`!\\[second shot\\]\\(${escapeRe(URL_B)}\\)\\n\\*\\*Figure: second shot\\*\\*`),
    );
  });

  it("dedupes the SAME image repeated twice on one line", () => {
    // The #834 duplicate-screenshot symptom expressed inline on a single line.
    const body = `![Crash](${URL_A}) ![Crash](${URL_A})`;
    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
    expect(out).toContain("**Figure: Crash**");
  });

  it("preserves query parameters in the screenshot URL", () => {
    const body = `![Shot](${URL_A})`;
    const out = normalizeIssueScreenshots(body);
    expect(out).toContain(URL_A);
    expect(out).toContain("sv=2025-05-05");
    expect(out).toContain("sig=xyz");
  });

  it("returns bodies without images unchanged", () => {
    const body = "### Pain\nNo screenshots here.\n\n### Acceptance Criteria\n- [ ] Done";
    expect(normalizeIssueScreenshots(body)).toBe(body);
  });

  it("keeps the '### Screenshots' copy (not a stray top embed) so the conventional section is not emptied", () => {
    // The prompt steers the model to put the single captioned screenshot in "### Screenshots"
    // (near the bottom of the bug template). If it ALSO leaves a stray top embed, the surviving
    // image must be the one inside "### Screenshots" — not the stray — or the guard would empty
    // the section and contradict the prompt.
    const body = [
      "### Pain",
      `![stray](${URL_A})`,
      "",
      "### Screenshots",
      `![Login page crashes on submit](${URL_A})`,
      "**Figure: Login page crashes on submit**",
    ].join("\n");

    const out = normalizeIssueScreenshots(body);

    // Image appears exactly once, and it is the one in the Screenshots section.
    expect(out.split(URL_A).length - 1).toBe(1);
    // The descriptive caption survives; the weak stray caption is not synthesised at the top.
    expect(out).toContain("**Figure: Login page crashes on submit**");
    expect(out).not.toContain("**Figure: stray**");

    // The "### Screenshots" section still has the image directly under it (section not emptied).
    expect(out).toContain(
      `### Screenshots\n![Login page crashes on submit](${URL_A})\n**Figure: Login page crashes on submit**`,
    );

    // The stray top embed under "### Pain" is gone.
    expect(out).toContain("### Pain");
    expect(out).not.toContain(`### Pain\n![stray](${URL_A})`);
  });

  it("carries the dropped caption forward to the surviving '### Screenshots' embed when it lacks one", () => {
    const body = [
      "### Pain",
      `![stray top](${URL_A})`,
      "**Figure: stray top**",
      "",
      "### Screenshots",
      `![Crash on submit](${URL_A})`,
    ].join("\n");

    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    // The Screenshots embed survives; lacking its own caption it reuses the dropped caption
    // rather than synthesising a fresh one (carry-forward preserves the authored caption).
    expect(out).toContain(`### Screenshots\n![Crash on submit](${URL_A})\n**Figure: stray top**`);
  });

  it("synthesises a caption from alt only when NO dropped caption exists to carry forward", () => {
    const body = [
      "### Pain",
      `![Screenshot description](${URL_A})`, // duplicate, no caption
      "",
      "### Screenshots",
      `![Crash on submit](${URL_A})`, // survivor, no caption either
    ].join("\n");

    const out = normalizeIssueScreenshots(body);
    expect(out.split(URL_A).length - 1).toBe(1);
    // No caption anywhere to carry forward, so the survivor's caption is synthesised from its alt.
    expect(out).toContain(
      `### Screenshots\n![Crash on submit](${URL_A})\n**Figure: Crash on submit**`,
    );
  });

  it("carries a RICH dropped caption forward to a caption-less survivor instead of synthesising a weaker one", () => {
    // Regression (#834): the top embed carries a descriptive LLM caption while the
    // "### Screenshots" copy has only bare alt text. We keep the section copy (correct) but must
    // NOT re-synthesise a weaker caption from its alt and discard the rich one — that would make
    // the rendered caption strictly worse than what the model wrote.
    const body = [
      "### Pain",
      `![Login page crashes](${URL_A})`,
      "**Figure: Login page crashes on submit**",
      "",
      "### Screenshots",
      `![Login page crashes](${URL_A})`,
    ].join("\n");

    const out = normalizeIssueScreenshots(body);

    expect(out.split(URL_A).length - 1).toBe(1);
    // The rich top caption is carried forward to the surviving Screenshots-section embed.
    expect(out).toContain(
      `### Screenshots\n![Login page crashes](${URL_A})\n**Figure: Login page crashes on submit**`,
    );
    // The weaker alt-derived caption is NOT synthesised, and the detail is not lost.
    expect(out).not.toMatch(/\*\*Figure: Login page crashes\*\*/);
    expect(out).toContain("on submit");
    // Exactly one caption remains.
    expect(out.match(/\*\*Figure:/g)?.length).toBe(1);
  });
});

describe("isBacklogItemMutationTool — #834 gating (anchored allow-list, not keyword spotting)", () => {
  it("fires for backlog CREATE/UPDATE tools across providers", () => {
    expect(isBacklogItemMutationTool("GitHub__create_issue")).toBe(true);
    expect(isBacklogItemMutationTool("GitHub__update_issue")).toBe(true);
    expect(isBacklogItemMutationTool("Azure_DevOps__wit_create_work_item")).toBe(true);
    expect(isBacklogItemMutationTool("Azure_DevOps__wit_update_work_item")).toBe(true);
    expect(isBacklogItemMutationTool("Jira__jira_create_issue")).toBe(true);
    expect(isBacklogItemMutationTool("Jira__editJiraIssue")).toBe(true);
    // Unprefixed names work too.
    expect(isBacklogItemMutationTool("create_issue")).toBe(true);
  });

  it("fires for the LIVE GitHub `issue_write` tool (action-based, ends in `write` not `issue`)", () => {
    // The official remote GitHub MCP server (api.githubcopilot.com/mcp) consolidated
    // create_issue/update_issue into a single `issue_write` tool. Its bare name ends in `write`,
    // so an end-anchored noun would silently miss it and the #834 backstop would never run for the
    // configured GitHub server. The guard must recognise it.
    expect(isBacklogItemMutationTool("GitHub__issue_write")).toBe(true);
    expect(isBacklogItemMutationTool("issue_write")).toBe(true);
  });

  it("does NOT fire for `sub_issue_write` (manages parent/child links — has no body)", () => {
    // GitHub's sub_issue_write reorders/links sub-issues; it has no `body` to normalise.
    expect(isBacklogItemMutationTool("GitHub__sub_issue_write")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__issue_read")).toBe(false);
  });

  it("does NOT fire for comment tools (the body field carries user-facing comment text)", () => {
    // The exact false positive the old regex produced: issue + add → rewrote comment bodies.
    expect(isBacklogItemMutationTool("GitHub__add_issue_comment")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__create_issue_comment")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__update_issue_comment")).toBe(false);
    expect(isBacklogItemMutationTool("Jira__add_comment")).toBe(false);
  });

  it("does NOT fire for read-only / cache / search / list / get tools", () => {
    expect(isBacklogItemMutationTool("GitHub__update_issue_cache")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__search_repositories")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__get_file_contents")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__list_issues")).toBe(false);
    expect(isBacklogItemMutationTool("Jira__get_issue")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__create_pull_request")).toBe(false);
    expect(isBacklogItemMutationTool("GitHub__create_or_update_file")).toBe(false);
  });
});

describe("buildFigureCaption", () => {
  it("uses provided alt text", () => {
    expect(buildFigureCaption("The settings dialog")).toBe("**Figure: The settings dialog**");
  });

  it("falls back for empty or placeholder alt text", () => {
    expect(buildFigureCaption("")).toBe("**Figure: Screenshot from the recording**");
    expect(buildFigureCaption("Screenshot")).toBe("**Figure: Screenshot from the recording**");
    expect(buildFigureCaption("Screenshot description")).toBe(
      "**Figure: Screenshot from the recording**",
    );
  });
});
