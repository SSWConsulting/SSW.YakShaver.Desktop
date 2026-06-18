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

type LlmResponse = {
  response: { messages: unknown[] };
  content: Array<{ type: string; text?: string }>;
  finishReason: string;
  text: string;
  toolCalls?: Array<{ toolName: string; toolCallId: string; input: Record<string, unknown> }>;
};

/**
 * Builds an orchestrator instance whose static collaborators (LLM provider + MCP server
 * manager) are stubbed, so manualLoopAsync executes the real control flow against scripted
 * LLM responses and a scripted set of MCP tools.
 *
 * `tools` models the tools exposed by connected MCP servers. An empty map models the GitHub
 * MCP server being signed out / not connected: the create-issue tool is gone.
 */
function makeOrchestrator(
  llmResponses: LlmResponse[],
  tools: Record<string, { execute?: (...args: unknown[]) => unknown }> = {},
  whitelist: string[] = [],
) {
  const generateTextWithTools = vi.fn();
  for (const r of llmResponses) generateTextWithTools.mockResolvedValueOnce(r);

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = { generateTextWithTools };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsWithServerPrefixAsync: vi.fn().mockResolvedValue(tools),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  return { orch, generateTextWithTools };
}

function stop(text: string): LlmResponse {
  return { response: { messages: [] }, content: [], finishReason: "stop", text };
}

describe("#833 — manualLoopAsync reports a real outcome, not just a graceful finish", () => {
  it("signals failure when the backlog MCP is signed out and no work item is created", async () => {
    // GitHub MCP signed out => no create-issue tool. The model apologises and finishes on `stop`.
    const limitation =
      "I wasn't able to create the GitHub issue because the GitHub MCP server is not connected.";
    const { orch } = makeOrchestrator([stop(limitation)], /* tools = signed out */ {});

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    // Before the fix this returned a plain truthy string => false success. Now the outcome is explicit.
    expect(result.backlogActionSucceeded).toBe(false);
    expect(result.terminationReason).toBe("stop");
    expect(result.text).toBe(limitation);
  });

  it("signals failure when the loop ends on the length limit without creating an item", async () => {
    const lengthExit: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "length",
      text: "",
    };
    const { orch } = makeOrchestrator([lengthExit]);

    const result = await orch.manualLoopAsync("t", undefined, {});

    expect(result.backlogActionSucceeded).toBe(false);
    expect(result.terminationReason).toBe("length");
  });

  it("signals failure when only internal (non-backlog) tools run", async () => {
    // The model captures a video frame (an internal Yak tool) then gives up — nothing filed.
    const internalTool = {
      execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "frame captured" }] }),
    };
    const toolCallTurn: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "tool-calls",
      text: "",
      toolCalls: [
        { toolName: "Yak_Video_Tools__capture_video_frame", toolCallId: "tc1", input: {} },
      ],
    };
    const { orch } = makeOrchestrator(
      [toolCallTurn, stop("I drafted a work item but couldn't file it.")],
      { Yak_Video_Tools__capture_video_frame: internalTool },
      ["Yak_Video_Tools__capture_video_frame"],
    );

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(internalTool.execute).toHaveBeenCalled();
    expect(result.backlogActionSucceeded).toBe(false);
    expect(result.terminationReason).toBe("stop");
  });

  it("reports success when a create-issue tool call actually succeeds (no false negative)", async () => {
    const createIssue = {
      execute: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Created issue #1: https://github.com/o/r/issues/1" }],
        isError: false,
      }),
    };
    const toolCallTurn: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "tool-calls",
      text: "",
      toolCalls: [{ toolName: "github__create_issue", toolCallId: "tc1", input: { title: "Bug" } }],
    };
    const { orch } = makeOrchestrator(
      [toolCallTurn, stop("Done! Created issue #1.")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
    );

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(createIssue.execute).toHaveBeenCalled();
    expect(result.backlogActionSucceeded).toBe(true);
    expect(result.terminationReason).toBe("stop");
  });

  it("does NOT count a failed (errored) create-issue tool result as success", async () => {
    // The create-issue tool exists but returns an auth error as content (isError) — the exact
    // "signed out" #833 path where the MCP server replies with an error instead of throwing.
    const createIssue = {
      execute: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "401 Unauthorized: token expired" }],
        isError: true,
      }),
    };
    const toolCallTurn: LlmResponse = {
      response: { messages: [] },
      content: [],
      finishReason: "tool-calls",
      text: "",
      toolCalls: [{ toolName: "github__create_issue", toolCallId: "tc1", input: { title: "Bug" } }],
    };
    const { orch } = makeOrchestrator(
      [toolCallTurn, stop("I couldn't create the issue — you appear to be signed out.")],
      { github__create_issue: createIssue },
      ["github__create_issue"],
    );

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(createIssue.execute).toHaveBeenCalled();
    expect(result.backlogActionSucceeded).toBe(false);
    expect(result.terminationReason).toBe("stop");
  });
});
