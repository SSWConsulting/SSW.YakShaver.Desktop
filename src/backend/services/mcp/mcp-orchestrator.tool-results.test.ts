import { generateText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

const requestToolApproval = vi.fn();

// mcp-orchestrator pulls in electron / telemetry / user-interaction / provider modules at load.
// We mock them so the real manualLoopAsync logic runs in a plain node test environment.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));
vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: { getInstance: () => ({ trackEvent: vi.fn() }) },
}));
vi.mock("../user-interaction/user-interaction-service", () => ({
  UserInteractionService: { getInstance: () => ({ requestToolApproval }) },
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

// A turn where the model asks for several tools at once, as OpenAI does with parallel tool calls.
const parallelToolTurn = (toolCalls: ToolCall[]) => ({
  response: {
    messages: [
      {
        role: "assistant",
        content: toolCalls.map((call) => ({ type: "tool-call", ...call })),
      },
    ],
  },
  content: [],
  finishReason: "tool-calls",
  text: "",
  toolCalls,
});
const stop = { response: { messages: [] }, content: [], finishReason: "stop", text: "Done." };
const tool = (text: string) => ({
  execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text }], isError: false }),
});

/**
 * Runs the loop with scripted model turns and returns the history it sent back to the model on
 * the second turn — i.e. what the model sees after the first batch of tool calls.
 */
async function historyAfterFirstToolTurn(
  toolCalls: ToolCall[],
  tools: Record<string, { execute?: (...args: unknown[]) => unknown }>,
  whitelist: string[],
): Promise<ModelMessage[]> {
  const sentHistories: ModelMessage[][] = [];
  const responses = [parallelToolTurn(toolCalls), stop];
  const generateTextWithTools = vi.fn(async (messages: ModelMessage[]) => {
    // The loop mutates one array, so snapshot what was sent on each call.
    sentHistories.push([...messages]);
    return responses[sentHistories.length - 1];
  });

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = {
    generateTextWithTools,
    generateObject: vi.fn().mockResolvedValue({ achieved: false, artifacts: [], reasoning: "" }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsWithServerPrefixAsync: vi.fn().mockResolvedValue(tools),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  await orch.manualLoopAsync("a bug report transcript", undefined, {});
  return sentHistories[1] ?? [];
}

// Replays a history through the real AI SDK, which rejects any tool call left without a result
// before the next user message (MissingToolResultsError).
async function sendToRealSdk(messages: ModelMessage[]): Promise<void> {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
  await generateText({ model, messages, allowSystemInMessages: true });
}

describe("every tool call in a batch gets a result before the next user message", () => {
  it("a change request on the first of two parallel calls still yields a valid history", async () => {
    requestToolApproval.mockResolvedValueOnce({ kind: "request_changes", feedback: "use repo X" });
    const listIssues = tool("Open issues: none");

    const history = await historyAfterFirstToolTurn(
      [
        { toolName: "github__create_issue", toolCallId: "c1", input: {} },
        { toolName: "github__list_issues", toolCallId: "c2", input: {} },
      ],
      { github__create_issue: tool("unused"), github__list_issues: listIssues },
      ["github__list_issues"],
    );

    expect(listIssues.execute).toHaveBeenCalled();
    expect(history.at(-1)).toMatchObject({ role: "user" });
    await expect(sendToRealSdk(history)).resolves.toBeUndefined();
  });

  it("a call to an unknown tool is answered with an error result", async () => {
    const history = await historyAfterFirstToolTurn(
      [{ toolName: "github__no_such_tool", toolCallId: "c1", input: {} }],
      {},
      ["github__no_such_tool"],
    );

    expect(history.at(-1)).toMatchObject({
      role: "tool",
      content: [{ toolCallId: "c1", output: { type: "error-text" } }],
    });
    await expect(sendToRealSdk(history)).resolves.toBeUndefined();
  });
});
