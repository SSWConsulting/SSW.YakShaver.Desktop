import { describe, expect, it, vi } from "vitest";

// mcp-orchestrator pulls in electron / telemetry / user-interaction / provider modules at load.
// We mock them so the REAL manualLoopAsync control flow runs in a plain node test environment.
// This is the happy-path twin of the #834 fix: it proves the screenshot-markdown guard actually
// fires INSIDE the real execute path (manualLoopAsync → tool.execute), not just as a unit-callable
// private method. The sibling screenshot-gating.test.ts proves the method's logic in isolation;
// this proves the wiring — the create/update tool's execute receives the deduped + captioned body.
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

type ToolCall = { toolName: string; toolCallId: string; input: Record<string, unknown> };
type LlmResponse = {
  response: { messages: unknown[] };
  content: Array<{ type: string; text?: string }>;
  finishReason: string;
  text: string;
  toolCalls?: ToolCall[];
};
type Verdict = {
  achieved: boolean;
  artifacts: Array<{ type: string; idOrUrl: string }>;
  reasoning?: string;
};

function makeOrchestrator(
  llmResponses: LlmResponse[],
  tools: Record<string, { execute?: (...args: unknown[]) => unknown }>,
  whitelist: string[],
  judgeVerdict: Verdict,
) {
  const generateTextWithTools = vi.fn();
  for (const r of llmResponses) generateTextWithTools.mockResolvedValueOnce(r);
  const generateObject = vi.fn().mockResolvedValue(judgeVerdict);

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = { generateTextWithTools, generateObject };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsWithServerPrefixAsync: vi.fn().mockResolvedValue(tools),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  return { orch };
}

const stop = (text: string): LlmResponse => ({
  response: { messages: [] },
  content: [],
  finishReason: "stop",
  text,
});
const toolTurn = (toolName: string, input: Record<string, unknown>): LlmResponse => ({
  response: { messages: [] },
  content: [],
  finishReason: "tool-calls",
  text: "",
  toolCalls: [{ toolName, toolCallId: "tc1", input }],
});

const URL = "https://example.com/images/shot.png?sig=abc";
// The exact #834 dedup shape: a stray top-of-body embed AND a copy under "### Screenshots".
const dupeBody = [
  "### Pain",
  `![stray](${URL})`,
  "",
  "### Screenshots",
  `![Crash on submit](${URL})`,
  "**Figure: Crash on submit**",
].join("\n");

describe("#834 — the screenshot-markdown guard fires in the REAL execute path (manualLoopAsync)", () => {
  it("create_issue.execute receives a body with the image exactly once and a Figure caption", async () => {
    let receivedBody: string | undefined;
    const createIssue = {
      execute: vi.fn().mockImplementation((args: { body?: string }) => {
        receivedBody = args.body;
        return { content: [{ type: "text", text: "Created #1: https://github.com/o/r/issues/1" }] };
      }),
    };
    const { orch } = makeOrchestrator(
      [
        toolTurn("github__create_issue", { title: "Bug", body: dupeBody }),
        stop("Done! Created issue #1."),
      ],
      { github__create_issue: createIssue },
      ["github__create_issue"],
      {
        achieved: true,
        artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/1" }],
      },
    );

    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(createIssue.execute).toHaveBeenCalledTimes(1);
    expect(receivedBody).toBeDefined();
    // Image URL appears exactly once (the stray top embed was deduped away).
    expect((receivedBody as string).split(URL).length - 1).toBe(1);
    // The surviving "### Screenshots" copy keeps its caption.
    expect(receivedBody as string).toContain("**Figure: Crash on submit**");
    // The stray top embed and its line are gone.
    expect(receivedBody as string).not.toContain("![stray]");
    expect(r.backlogActionSucceeded).toBe(true);
  });

  it("the live GitHub `issue_write` tool is also normalised (not just the legacy create_issue)", async () => {
    // The official remote GitHub MCP server exposes `issue_write` (action-based), NOT create_issue.
    // This asserts the guard recognises the live tool name and fires for it in the real loop.
    let receivedBody: string | undefined;
    const issueWrite = {
      execute: vi.fn().mockImplementation((args: { body?: string }) => {
        receivedBody = args.body;
        return { content: [{ type: "text", text: "Created #2: https://github.com/o/r/issues/2" }] };
      }),
    };
    const { orch } = makeOrchestrator(
      [
        toolTurn("GitHub__issue_write", { method: "create", body: dupeBody }),
        stop("Done! Created issue #2."),
      ],
      { GitHub__issue_write: issueWrite },
      ["GitHub__issue_write"],
      {
        achieved: true,
        artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/2" }],
      },
    );

    await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(issueWrite.execute).toHaveBeenCalledTimes(1);
    expect(receivedBody).toBeDefined();
    expect((receivedBody as string).split(URL).length - 1).toBe(1);
    expect(receivedBody as string).toContain("**Figure: Crash on submit**");
  });

  it("a comment tool's body is passed through to execute UNCHANGED (no false rewrite)", async () => {
    // The guard must NOT touch a comment body — proving the exclusion holds in the real path too.
    let receivedBody: string | undefined;
    const addComment = {
      execute: vi.fn().mockImplementation((args: { body?: string }) => {
        receivedBody = args.body;
        return { content: [{ type: "text", text: "commented" }] };
      }),
    };
    const { orch } = makeOrchestrator(
      [
        toolTurn("github__add_issue_comment", { issue_number: 1, body: dupeBody }),
        stop("Added the comment."),
      ],
      { github__add_issue_comment: addComment },
      ["github__add_issue_comment"],
      { achieved: false, artifacts: [] },
    );

    await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(addComment.execute).toHaveBeenCalledTimes(1);
    expect(receivedBody).toBe(dupeBody);
  });
});
