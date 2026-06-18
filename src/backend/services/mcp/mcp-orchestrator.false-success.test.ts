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

  it("degraded fallback: if the judge call throws, scan results for an artifact rather than hard-fail", async () => {
    const createIssue = tool("Created issue #7: https://github.com/o/r/issues/7");
    const { orch, generateObject } = makeOrchestrator(
      [toolTurn("github__create_issue"), stop("Done.")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
    );
    generateObject.mockRejectedValueOnce(new Error("model unavailable"));
    const r = await orch.manualLoopAsync("a bug report transcript", undefined, {});
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(r.backlogActionSucceeded).toBe(true); // artifact present in the successful result
    expect(r.artifacts[0]?.idOrUrl).toContain("https://github.com/o/r/issues/7");
  });
});
