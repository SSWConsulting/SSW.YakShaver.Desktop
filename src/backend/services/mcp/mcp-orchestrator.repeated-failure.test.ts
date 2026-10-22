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

/**
 * #1062: the model kept repeating a call that failed with the same error (GitHub's issue_write
 * with an invented parent_issue_number, then add_issue_comment with an invented comment_id), until
 * the iteration cap or timeout. A prompt rule alone did not stop it, so the loop must.
 */
const FAILURE = "comment_id cannot be combined with body";

function makeOrchestrator(failingTool: { execute: ReturnType<typeof vi.fn> }) {
  let call = 0;
  // The model keeps calling the same tool, varying the body each time (so exact-argument
  // matching would never catch it).
  const generateTextWithTools = vi.fn().mockImplementation(async () => {
    call++;
    return {
      response: { messages: [] },
      content: [],
      finishReason: "tool-calls",
      text: "",
      toolCalls: [
        {
          toolName: "GitHub__add_issue_comment",
          toolCallId: `tc${call}`,
          input: { comment_id: 1, body: `attempt ${call}` },
        },
      ],
    };
  });

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = {
    generateTextWithTools,
    generateObject: vi.fn().mockResolvedValue({ achieved: false, artifacts: [] }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsForSelectedServersAsync: vi
      .fn()
      .mockResolvedValue({ GitHub__add_issue_comment: failingTool }),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(["GitHub__add_issue_comment"]),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  return { orch, generateTextWithTools };
}

const failingTool = () => ({
  execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text: FAILURE }], isError: true }),
});

describe("MCPOrchestrator stops a tool that keeps failing the same way (#1062)", () => {
  it("stops after the third identical failure instead of running to the iteration cap", async () => {
    const tool = failingTool();
    const { orch } = makeOrchestrator(tool);

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(tool.execute).toHaveBeenCalledTimes(3);
    expect(result.terminationReason).toBe("repeated-tool-failure");
    expect(result.backlogActionSucceeded).toBe(false);
    expect(result.text).toContain("GitHub__add_issue_comment");
    expect(result.text).toContain(FAILURE);
  });

  it("tells the model the call already failed before giving up", async () => {
    const tool = failingTool();
    const { orch, generateTextWithTools } = makeOrchestrator(tool);

    await orch.manualLoopAsync("a bug report transcript", undefined, {});

    // The third model turn sees the second failure's result, which must carry the nudge.
    const thirdTurnMessages = generateTextWithTools.mock.calls[2][0] as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResults = JSON.stringify(thirdTurnMessages.filter((m) => m.role === "tool"));
    expect(toolResults).toContain("already failed");
  });

  it("keeps going when a different error comes back", async () => {
    const tool = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ content: [{ type: "text", text: "error A" }], isError: true })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "error B" }], isError: true })
        .mockResolvedValueOnce({ content: [{ type: "text", text: "error C" }], isError: true })
        .mockResolvedValue({ content: [{ type: "text", text: "error D" }], isError: true }),
    };
    const { orch } = makeOrchestrator(tool);

    const result = await orch.manualLoopAsync("a bug report transcript", undefined, {
      maxToolIterations: 4,
    });

    expect(tool.execute).toHaveBeenCalledTimes(4);
    expect(result.terminationReason).toBe("max-iterations");
  });
});
