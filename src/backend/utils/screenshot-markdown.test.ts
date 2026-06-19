import { describe, expect, it } from "vitest";
import { buildFigureCaption, normalizeIssueScreenshots } from "./screenshot-markdown";

const URL_A =
  "https://sayakshaverproduction.blob.core.windows.net/images/desktop-screenshots/abc.png?sv=2025-05-05&sig=xyz";
const URL_B = "https://example.com/images/second.png?token=123";

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
