import { describe, expect, it, vi } from "vitest";

// mcp-orchestrator pulls in electron / telemetry / user-interaction / provider modules at load.
// Mock them so we can construct the orchestrator and exercise its private gating method directly.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));
vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: { getInstance: () => ({ trackEvent: vi.fn() }) },
}));
vi.mock("../user-interaction/user-interaction-service", () => ({
  UserInteractionService: { getInstance: () => ({ requestToolApproval: vi.fn() }) },
}));
vi.mock("./language-model-provider", () => ({
  LanguageModelProvider: { getInstance: vi.fn() },
}));
vi.mock("./mcp-server-manager", () => ({
  MCPServerManager: { getInstanceAsync: vi.fn() },
}));
vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { MCPOrchestrator } from "./mcp-orchestrator";

const URL = "https://example.com/images/shot.png?sig=abc";

// normalizeScreenshotMarkdownInArgs is private; access it via the prototype like the sibling
// false-success test accesses internals. This proves the BOTH-SIDES behaviour of the new branch:
// which tools get touched, which body fields get rewritten, and which are left strictly alone.
function normalizeArgs(toolName: string, input: Record<string, unknown>) {
  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  // biome-ignore lint/suspicious/noExplicitAny: invoking a private method under test
  return (orch as any).normalizeScreenshotMarkdownInArgs(toolName, input);
}

describe("normalizeScreenshotMarkdownInArgs — #834 gating wiring", () => {
  const dupeBody = [
    "### Pain",
    `![stray](${URL})`,
    "",
    "### Screenshots",
    `![Crash on submit](${URL})`,
    "**Figure: Crash on submit**",
  ].join("\n");

  it("rewrites the `body` field of a create-issue tool (dedupe + keep the Screenshots copy)", () => {
    const out = normalizeArgs("GitHub__create_issue", { title: "Bug", body: dupeBody });
    const body = out.body as string;
    expect(body.split(URL).length - 1).toBe(1);
    expect(body).toContain("**Figure: Crash on submit**");
    expect(body).not.toContain("**Figure: stray**");
    // title is untouched
    expect(out.title).toBe("Bug");
  });

  it("rewrites the `description` field of an update-work-item tool", () => {
    const out = normalizeArgs("Azure_DevOps__wit_update_work_item", { description: dupeBody });
    expect((out.description as string).split(URL).length - 1).toBe(1);
  });

  it("is a NO-OP for non-backlog read-only tools (body left byte-for-byte identical)", () => {
    const input = { query: "repo:foo", body: dupeBody };
    const out = normalizeArgs("GitHub__search_repositories", input);
    expect(out.body).toBe(dupeBody);
    const out2 = normalizeArgs("GitHub__get_file_contents", { content: dupeBody });
    expect(out2.content).toBe(dupeBody);
  });

  it("does NOT rewrite a comment tool body (user-facing comment text is preserved verbatim)", () => {
    // The exact false positive the old keyword regex caused: issue + add → comment body rewritten.
    const out = normalizeArgs("GitHub__add_issue_comment", { body: dupeBody });
    expect(out.body).toBe(dupeBody);
  });

  it("does NOT rewrite a read-only cache tool that merely contains issue+update in its name", () => {
    const out = normalizeArgs("GitHub__update_issue_cache", { body: dupeBody });
    expect(out.body).toBe(dupeBody);
  });

  it("returns the input object unchanged when no body-like field is present", () => {
    const input = { title: "Just a title", number: 42 };
    const out = normalizeArgs("GitHub__create_issue", input);
    expect(out).toEqual(input);
  });
});
