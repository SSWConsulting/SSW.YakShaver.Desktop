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
 * #1062 (regression from #603): the OpenAI orchestrator must only load tools from the selected
 * project's MCP servers. It collected tools from EVERY enabled server instead, so a GitHub shave
 * also connected (and started an OAuth sign-in for) an unrelated, unauthenticated Jira server.
 */
function makeOrchestrator() {
  const collectToolsForSelectedServersAsync = vi.fn().mockResolvedValue({});
  const collectToolsWithServerPrefixAsync = vi.fn().mockResolvedValue({});
  const generateTextWithTools = vi.fn().mockResolvedValue({
    response: { messages: [] },
    content: [],
    finishReason: "stop",
    text: "done",
  });

  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).languageModelProvider = {
    generateTextWithTools,
    generateObject: vi.fn(),
  };
  // biome-ignore lint/suspicious/noExplicitAny: injecting stubs into private statics for test
  (MCPOrchestrator as any).mcpServerManager = {
    collectToolsForSelectedServersAsync,
    collectToolsWithServerPrefixAsync,
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue([]),
  };

  const orch = Object.create(MCPOrchestrator.prototype) as MCPOrchestrator;
  return { orch, collectToolsForSelectedServersAsync, collectToolsWithServerPrefixAsync };
}

describe("MCPOrchestrator tool loading respects the project's MCP servers", () => {
  it("only loads tools from the servers selected for the project", async () => {
    const { orch, collectToolsForSelectedServersAsync, collectToolsWithServerPrefixAsync } =
      makeOrchestrator();

    await orch.manualLoopAsync("a bug report transcript", undefined, {
      serverFilter: ["github-server-id"],
    });

    expect(collectToolsForSelectedServersAsync).toHaveBeenCalledWith(["github-server-id"]);
    expect(collectToolsWithServerPrefixAsync).not.toHaveBeenCalled();
  });

  it("falls back to every enabled server when the project selects none", async () => {
    const { orch, collectToolsForSelectedServersAsync } = makeOrchestrator();

    await orch.manualLoopAsync("a bug report transcript", undefined, {});

    expect(collectToolsForSelectedServersAsync).toHaveBeenCalledWith(undefined);
  });
});
