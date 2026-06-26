import { describe, expect, it, vi } from "vitest";

// mcp-orchestrator pulls in electron / telemetry / user-interaction / provider modules at load.
// We mock them so the real manualLoopAsync logic runs in a plain node test environment.
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

import { BacklogOutcomeSchema, MCPOrchestrator } from "./mcp-orchestrator";

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

/**
 * Builds an orchestrator whose static collaborators are stubbed:
 *  - generateTextWithTools  → scripted LLM turns
 *  - generateObject         → the outcome JUDGE's verdict (so we control its decision)
 *  - the MCP server manager → scripted tools + whitelist
 * so manualLoopAsync runs its real control flow against scripted inputs.
 */
function makeOrchestrator(
  llmResponses: LlmResponse[],
  tools: Record<string, { execute?: (...args: unknown[]) => unknown }> = {},
  whitelist: string[] = [],
  judgeVerdict: Verdict = { achieved: false, artifacts: [] },
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
  return { orch, generateTextWithTools, generateObject };
}

const stop = (text: string): LlmResponse => ({
  response: { messages: [] },
  content: [],
  finishReason: "stop",
  text,
});
const toolTurn = (toolName: string): LlmResponse => ({
  response: { messages: [] },
  content: [],
  finishReason: "tool-calls",
  text: "",
  toolCalls: [{ toolName, toolCallId: "tc1", input: {} }],
});
const tool = (text: string, isError = false) => ({
  execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text }], isError }),
});

describe("#833 — outcome is judged from tool RESULTS, not tool-name heuristics or model narration", () => {
  it("signed-out / no tool ran → not achieved, and the judge is NOT called (cheap path)", async () => {
    const { orch, generateObject } = makeOrchestrator(
      [stop("I couldn't create the GitHub issue because the server is not connected.")],
      {},
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(r.backlogActionSucceeded).toBe(false);
    expect(r.terminationReason).toBe("stop");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("a create tool that returns an ERROR result → not achieved, judge not called (no successful call)", async () => {
    const createIssue = tool("401 Unauthorized: token expired", /* isError */ true);
    const { orch, generateObject } = makeOrchestrator(
      [
        toolTurn("github__create_issue"),
        stop("I couldn't create the issue — you appear to be signed out."),
      ],
      { github__create_issue: createIssue },
      ["github__create_issue"],
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(createIssue.execute).toHaveBeenCalled();
    expect(r.backlogActionSucceeded).toBe(false);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("length limit → not achieved (no judge)", async () => {
    const lengthExit: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "length",
      text: "",
    };
    const { orch, generateObject } = makeOrchestrator([lengthExit]);
    const r = await orch.manualLoopAsync("t", undefined, {});
    expect(r.backlogActionSucceeded).toBe(false);
    expect(r.terminationReason).toBe("length");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("only an internal tool ran → judge consulted, returns false, nothing filed", async () => {
    const internal = tool("frame captured");
    const { orch, generateObject } = makeOrchestrator(
      [
        toolTurn("Yak_Video_Tools__capture_video_frame"),
        stop("I drafted a work item but couldn't file it."),
      ],
      { Yak_Video_Tools__capture_video_frame: internal },
      ["Yak_Video_Tools__capture_video_frame"],
      { achieved: false, artifacts: [] },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(internal.execute).toHaveBeenCalled();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(r.backlogActionSucceeded).toBe(false);
  });

  it("genuine create → achieved, with the cited artifact surfaced (happy path)", async () => {
    const createIssue = tool("Created issue #1: https://github.com/o/r/issues/1");
    const { orch, generateObject } = makeOrchestrator(
      [toolTurn("github__create_issue"), stop("Done! Created issue #1.")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
      {
        achieved: true,
        artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/1" }],
      },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(r.backlogActionSucceeded).toBe(true);
    expect(r.artifacts).toEqual([{ type: "issue", idOrUrl: "https://github.com/o/r/issues/1" }]);
  });

  it("model FALSELY claims success in its final message → judge rules on results, returns false", async () => {
    // The tool that ran is a read/cache tool — its NAME (`update_issue_cache`) is exactly the kind
    // the old regex false-matched on. The model's narration lies about creating an issue; the
    // judge, reading the (non-artifact) result, correctly rejects it.
    const readish = tool("cache refreshed for issue list (read-only)");
    const { orch, generateObject } = makeOrchestrator(
      [
        toolTurn("github__update_issue_cache"),
        stop("All done — I have created the issue for you!"),
      ],
      { github__update_issue_cache: readish },
      ["github__update_issue_cache"],
      { achieved: false, artifacts: [] },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(r.backlogActionSucceeded).toBe(false);
  });

  it("a real mutation tool the old regex would MISS (jira transition_issue) → achieved via results", async () => {
    // `transition_issue` contains none of the old regex's verbs → the old code reported a false
    // failure. The judge, reading the artifact in the result, correctly reports success.
    const transition = tool("Transitioned PROJ-42 to Done: https://jira.example/browse/PROJ-42");
    const { orch } = makeOrchestrator(
      [toolTurn("jira__transition_issue"), stop("Moved PROJ-42 to Done.")],
      { jira__transition_issue: transition },
      ["jira__transition_issue"],
      { achieved: true, artifacts: [{ type: "ticket", idOrUrl: "PROJ-42" }] },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(r.backlogActionSucceeded).toBe(true);
    expect(r.artifacts).toEqual([{ type: "ticket", idOrUrl: "PROJ-42" }]);
  });

  it("judge error → fails CLOSED (not achieved), never a regex scan of free text", async () => {
    const createIssue = tool("Created issue #7: https://github.com/o/r/issues/7");
    const { orch, generateObject } = makeOrchestrator(
      [toolTurn("github__create_issue"), stop("Done.")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
    );
    generateObject.mockRejectedValueOnce(new Error("model unavailable"));
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(r.backlogActionSucceeded).toBe(false);
    expect(r.artifacts).toEqual([]);
  });

  it("a successful READ tool with URLs in its result does NOT phantom-succeed when the judge errors", async () => {
    // The brittle degraded-scan would have matched the URL/`#1`; failing closed avoids that.
    const listIssues = tool("Open issues: #1 #2 https://github.com/o/r/issues/1");
    const { orch, generateObject } = makeOrchestrator(
      [toolTurn("github__list_issues"), stop("Here are the open issues.")],
      { github__list_issues: listIssues },
      ["github__list_issues"],
    );
    generateObject.mockRejectedValueOnce(new Error("model unavailable"));
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(r.backlogActionSucceeded).toBe(false);
  });

  it("issue created earlier, then the loop hits the LENGTH limit → still achieved (no false failure)", async () => {
    const createIssue = tool("Created issue #9: https://github.com/o/r/issues/9");
    const lengthExit: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "length",
      text: "",
    };
    const { orch, generateObject } = makeOrchestrator(
      [toolTurn("github__create_issue"), lengthExit],
      { github__create_issue: createIssue },
      ["github__create_issue"],
      {
        achieved: true,
        artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/9" }],
      },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(generateObject).toHaveBeenCalledTimes(1); // the judge runs on the length exit too
    expect(r.terminationReason).toBe("length");
    expect(r.backlogActionSucceeded).toBe(true);
    expect(r.artifacts).toEqual([{ type: "issue", idOrUrl: "https://github.com/o/r/issues/9" }]);
  });

  it("item created earlier, then the loop exhausts the iteration cap → still achieved", async () => {
    const createWorkItem = tool(
      "Created work item AB#42: https://dev.azure.com/o/p/_workitems/edit/42",
    );
    // maxToolIterations:1 forces the cap right after the create turn — no `stop`.
    const { orch } = makeOrchestrator(
      [toolTurn("ado__create_work_item")],
      { ado__create_work_item: createWorkItem },
      ["ado__create_work_item"],
      { achieved: true, artifacts: [{ type: "work_item", idOrUrl: "AB#42" }] },
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {
      maxToolIterations: 1,
    });
    expect(r.terminationReason).toBe("max-iterations");
    expect(r.backlogActionSucceeded).toBe(true);
  });

  it("judge says achieved:true but cites NO artifact → treated as failure (evidence required in code)", async () => {
    const createIssue = tool("the model forgot to copy the created id/url into artifacts");
    const { orch } = makeOrchestrator(
      [toolTurn("github__create_issue"), stop("Done!")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
      { achieved: true, artifacts: [] }, // claims success, cites nothing
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(r.backlogActionSucceeded).toBe(false);
  });

  it("judge says achieved:true but every cited artifact has a BLANK idOrUrl → treated as failure", async () => {
    // `idOrUrl` is `z.string()`, so "" parses. A non-empty `artifacts` array with only blank ids is
    // no evidence at all — it must not phantom-succeed.
    const createIssue = tool("the model emitted an artifact entry but left idOrUrl empty");
    const { orch } = makeOrchestrator(
      [toolTurn("github__create_issue"), stop("Done!")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
      { achieved: true, artifacts: [{ type: "issue", idOrUrl: "   " }] }, // blank/whitespace id
    );
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(r.backlogActionSucceeded).toBe(false);
  });
});

describe("BacklogOutcomeSchema stays OpenAI strict-structured-output compatible", () => {
  // A live run revealed that a `.default()`/`.optional()` field makes the real generateObject call
  // throw ("Invalid schema for response_format … Missing 'artifacts'") because OpenAI strict mode
  // requires every property in `required`. This guards against re-introducing an optional field.
  it("requires every field — an artifact-less or reasoning-less object must NOT parse", () => {
    expect(() => BacklogOutcomeSchema.parse({ achieved: true })).toThrow();
    expect(() => BacklogOutcomeSchema.parse({ achieved: true, artifacts: [] })).toThrow();
    expect(BacklogOutcomeSchema.parse({ achieved: true, artifacts: [], reasoning: "" })).toEqual({
      achieved: true,
      artifacts: [],
      reasoning: "",
    });
  });
});
