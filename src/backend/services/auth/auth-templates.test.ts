import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type AuthTemplateName, loadAuthTemplate, loadSuccessAuthTemplate } from "./auth-templates";

// Templates are read relative to __dirname, so these run against the real files that ship.
vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

vi.mock("../../config/env", () => ({
  config: {
    isDev: () => true,
    azure: () => ({}),
  },
}));

const templateNames: AuthTemplateName[] = [
  "successTemplate.html",
  "failureTemplate.html",
  "errorTemplate.html",
];

/**
 * A link that survived being handed to MSAL would leave the user on an unstyled page, and nothing
 * at runtime would report it: auth still succeeds and the text still reads correctly.
 */
describe("auth template shared styles", () => {
  it.each(templateNames)("%s carries the styles rather than a link to them", (templateName) => {
    const html = loadAuthTemplate(templateName);

    expect(html).not.toContain("<link");
    expect(html).toContain("<style>");
  });

  // The swap could "succeed" with no content and every other assertion here would still pass.
  it.each(templateNames)("%s includes the shared rules", (templateName) => {
    const html = loadAuthTemplate(templateName);

    expect(html).toContain(".card {");
    expect(html).toContain("background: #1a1414;");
  });

  // The badge is the one thing that differs between the pages.
  it.each([
    ["successTemplate.html", "status-badge--success"] as const,
    ["failureTemplate.html", "status-badge--warning"] as const,
    ["errorTemplate.html", "status-badge--error"] as const,
  ])("%s keeps its own status badge", (templateName, modifier) => {
    expect(loadAuthTemplate(templateName)).toContain(modifier);
  });

  it("keeps the success page's button styles after the shared styles", () => {
    const html = loadAuthTemplate("successTemplate.html");

    expect(html.indexOf(".card {")).toBeLessThan(html.indexOf(".cta {"));
  });

  // Substitution runs before inlining: `replace` takes the first match in the whole document, so
  // a stylesheet sitting in front of the href would swallow it.
  it("substitutes the deep link into the href, not somewhere in the styles", () => {
    expect(loadSuccessAuthTemplate()).toContain('href="yakshaver-desktop-dev://auth"');
  });

  // The success page follows its own deep link on load. Opened from disk the href is still the
  // bare placeholder, which the browser would chase as a relative URL — so the page navigates
  // away before anyone can look at it. The scheme guard is what keeps it reviewable.
  it("guards the redirect on the scheme, so an unsubstituted page stays put", () => {
    const raw = readFileSync(join(__dirname, "../../assets/auth/successTemplate.html"), "utf8");

    expect(raw).toContain("indexOf('yakshaver-desktop') === 0");
    expect(raw).toMatch(/href="redirectUrl"/);
  });
});
