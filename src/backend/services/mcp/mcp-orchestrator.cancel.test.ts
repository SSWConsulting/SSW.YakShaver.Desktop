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
 * #1062: Stop in My Shaves aborts the run. The in-process loop used to ignore `signal` entirely,
 * so a stopped shave kept calling the model and tools until the iteration cap or timeout.
 */
function makeOrchestrator(onModelTurn: () => void = () => {}) {
  const tool = {
    execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], isError: false }),
  };
  const generateTextWithTools = vi.fn().mockImplementation(async () => {
    onModelTurn();
    return {
      response: { messages: [] },
      content: [],
      finishReason: "tool-calls",
      text: "",
      toolCalls: [{ toolName: "GitHub__search_issues", toolCallId: "tc", input: {} }],
    };
  });

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = {
    generateTextWithTools,
    generateObject: vi.fn().mockResolvedValue({ achieved: false, artifacts: [] }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsForSelectedServersAsync: vi.fn().mockResolvedValue({ GitHub__search_issues: tool }),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(["GitHub__search_issues"]),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  return { orch, tool, generateTextWithTools };
}

describe("MCPOrchestrator honours Stop (#1062)", () => {
  it("does not start when the run was already stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    const { orch, generateTextWithTools } = makeOrchestrator();

    const result = await orch.manualLoopAsync("t", undefined, { signal: stop.signal });

    expect(result.terminationReason).toBe("cancelled");
    expect(generateTextWithTools).not.toHaveBeenCalled();
  });

  it("skips the pending tool call when Stop arrives during the model turn", async () => {
    const stop = new AbortController();
    const { orch, tool } = makeOrchestrator(() => stop.abort());

    const result = await orch.manualLoopAsync("t", undefined, { signal: stop.signal });

    expect(result.terminationReason).toBe("cancelled");
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("passes the signal to the model call so a long request can be cut short", async () => {
    const stop = new AbortController();
    const { orch, generateTextWithTools } = makeOrchestrator(() => stop.abort());

    await orch.manualLoopAsync("t", undefined, { signal: stop.signal });

    expect(generateTextWithTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      stop.signal,
    );
  });

  it("reports an aborted model call as cancelled rather than an error", async () => {
    const stop = new AbortController();
    const { orch, generateTextWithTools } = makeOrchestrator();
    generateTextWithTools.mockImplementationOnce(async () => {
      stop.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const result = await orch.manualLoopAsync("t", undefined, { signal: stop.signal });

    expect(result.terminationReason).toBe("cancelled");
  });
});
