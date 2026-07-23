import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolApprovalDecision } from "../../../shared/types/mcp";
import {
  McpToolBridge,
  type ToolBridgeManager,
  type ToolBridgeSettings,
  type ToolBridgeUserInteraction,
} from "./mcp-tool-bridge";

/**
 * Build a ToolSet where each tool carries an AI-SDK-shaped {description, inputSchema, execute}.
 * `Internal__*` stands in for an internal/in-memory server's tool — the #915 win is that these
 * are present here even though Claude Code can't reach them over its own transports.
 */
function makeToolSet(executeSpies: Record<string, ReturnType<typeof vi.fn>> = {}): ToolSet {
  const mk = (name: string, description: string) =>
    ({
      description,
      inputSchema: z.object({ title: z.string() }),
      execute: executeSpies[name] ?? vi.fn().mockResolvedValue(`ran ${name}`),
    }) as unknown as ToolSet[string];

  return {
    GitHub__create_issue: mk("GitHub__create_issue", "Create a GitHub issue"),
    Internal__fill_template: mk("Internal__fill_template", "Fill the internal template"),
  };
}

function makeManager(
  tools: ToolSet,
  whitelist: string[] = [],
): ToolBridgeManager & {
  collectToolsForSelectedServersAsync: ReturnType<typeof vi.fn>;
} {
  return {
    collectToolsForSelectedServersAsync: vi.fn().mockResolvedValue(tools),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
  };
}

function makeSettings(mode: "yolo" | "ask" | "wait"): ToolBridgeSettings {
  return { getSettingsAsync: vi.fn().mockResolvedValue({ toolApprovalMode: mode }) };
}

/** A stub {@link ToolBridgeUserInteraction} whose decision is scripted per test. */
function makeUserInteraction(
  decision: ToolApprovalDecision = { kind: "approve" },
): ToolBridgeUserInteraction & { requestToolApproval: ReturnType<typeof vi.fn> } {
  return { requestToolApproval: vi.fn().mockResolvedValue(decision) };
}

describe("McpToolBridge.listTools", () => {
  it("flattens the aggregated toolset INCLUDING internal servers, with JSON-Schema input", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet()),
      makeSettings("ask"),
      makeUserInteraction(),
    );
    const tools = await bridge.listTools();

    const names = tools.map((t) => t.name).sort();
    // Internal/in-memory server tool is present — the key #915 win.
    expect(names).toEqual(["GitHub__create_issue", "Internal__fill_template"]);

    const gh = tools.find((t) => t.name === "GitHub__create_issue");
    expect(gh?.description).toBe("Create a GitHub issue");
    // Zod inputSchema is resolved to a JSON Schema object.
    expect(gh?.inputSchema).toMatchObject({ type: "object" });
    expect((gh?.inputSchema as { properties?: unknown }).properties).toHaveProperty("title");
  });

  it("forwards the serverFilter to the manager so only selected servers are collected", async () => {
    const manager = makeManager(makeToolSet());
    const bridge = new McpToolBridge(manager, makeSettings("ask"), makeUserInteraction());
    await bridge.listTools(["srv-1", "srv-2"]);
    expect(manager.collectToolsForSelectedServersAsync).toHaveBeenCalledWith(["srv-1", "srv-2"]);
  });

  it("falls back to a permissive object schema when a tool has no inputSchema", async () => {
    const tools = {
      Bare__tool: { description: "no schema", execute: vi.fn() },
    } as unknown as ToolSet;
    const bridge = new McpToolBridge(
      makeManager(tools),
      makeSettings("yolo"),
      makeUserInteraction(),
    );
    const [summary] = await bridge.listTools();
    expect(summary.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("resolves to an EMPTY list (never rejects) when no enabled servers are healthy", async () => {
    // collectToolsWithServerPrefixAsync throws ("No MCP clients available" /
    // "No tools available...") whenever zero enabled servers are healthy — e.g.
    // the first-run "no MCP servers configured" state. The bridge must collapse
    // that to [] so the front-door's tools/list returns an empty list rather
    // than a JSON-RPC transport error mid-run.
    const manager = makeManager(makeToolSet());
    manager.collectToolsForSelectedServersAsync.mockRejectedValue(
      new Error("[MCPServerManager]: No MCP clients available"),
    );
    const bridge = new McpToolBridge(manager, makeSettings("ask"), makeUserInteraction());
    await expect(bridge.listTools()).resolves.toEqual([]);
  });
});

describe("McpToolBridge.callTool - approval policy enforcement", () => {
  let executeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeSpy = vi.fn().mockResolvedValue("Created #5");
  });

  it("yolo: runs ANY tool immediately (no whitelist needed)", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("yolo"),
      makeUserInteraction(),
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res).toEqual({ ok: true, result: "Created #5" });
  });

  it("ask: runs a whitelisted tool", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), ["GitHub__create_issue"]),
      makeSettings("ask"),
      makeUserInteraction(),
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });

  it("ask: a NON-whitelisted tool returns a structured not-approved result and does NOT run (no hang)", async () => {
    const userInteraction = makeUserInteraction();
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("ask"),
      userInteraction,
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).not.toHaveBeenCalled();
    // "ask" never prompts — a headless caller couldn't answer an interactive dialog anyway.
    expect(userInteraction.requestToolApproval).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a not-approved failure");
    expect(res.notApproved).toBe(true);
    expect(res.error).toMatch(/not approved/i);
  });

  it("wait: runs a whitelisted tool without prompting", async () => {
    const userInteraction = makeUserInteraction();
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), ["GitHub__create_issue"]),
      makeSettings("wait"),
      userInteraction,
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(userInteraction.requestToolApproval).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });

  it("wait: a NON-whitelisted tool raises the approval dialog and runs only once APPROVED (#920)", async () => {
    const userInteraction = makeUserInteraction({ kind: "approve" });
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("wait"),
      userInteraction,
    );
    const res = await bridge.callTool(
      "GitHub__create_issue",
      { title: "Bug" },
      undefined,
      "shave-1",
    );

    expect(userInteraction.requestToolApproval).toHaveBeenCalledWith(
      "GitHub__create_issue",
      { title: "Bug" },
      expect.objectContaining({ shaveId: "shave-1" }),
    );
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res).toEqual({ ok: true, result: "Created #5" });
  });

  it("wait: a DENIED tool does NOT run and returns a structured not-approved result", async () => {
    const userInteraction = makeUserInteraction({ kind: "deny_stop", feedback: "no thanks" });
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("wait"),
      userInteraction,
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a not-approved failure");
    expect(res.notApproved).toBe(true);
  });

  it("wait: a 'request_changes' decision does NOT run and surfaces the feedback", async () => {
    const userInteraction = makeUserInteraction({
      kind: "request_changes",
      feedback: "use a different title",
    });
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("wait"),
      userInteraction,
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a not-approved failure");
    expect(res.notApproved).toBe(true);
    expect(res.error).toContain("use a different title");
  });

  it("returns a clear error for an unknown tool", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet()),
      makeSettings("yolo"),
      makeUserInteraction(),
    );
    const res = await bridge.callTool("Nope__missing", {});
    expect(res).toEqual({ ok: false, error: "Unknown tool: Nope__missing" });
  });

  it("captures an execute() throw as a structured failure (does not reject)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("boom"));
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: boom }), ["GitHub__create_issue"]),
      makeSettings("ask"),
      makeUserInteraction(),
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("returns a structured failure (never rejects) when no enabled servers are healthy", async () => {
    // Same degenerate state as the listTools case: collecting the toolset throws.
    // callTool must collapse it to an empty toolset, so the existing "Unknown
    // tool" structured refusal is returned and the front-door can relay it as an
    // MCP isError result instead of rejecting with a transport error mid-run.
    const manager = makeManager(makeToolSet(), ["GitHub__create_issue"]);
    manager.collectToolsForSelectedServersAsync.mockRejectedValue(
      new Error("[MCPServerManager]: No tools available from selected/healthy servers"),
    );
    const bridge = new McpToolBridge(manager, makeSettings("yolo"), makeUserInteraction());
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a structured failure");
    expect(res.error).toMatch(/unknown tool/i);
  });

  it("defaults arguments to {} and passes them to execute()", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), []),
      makeSettings("yolo"),
      makeUserInteraction(),
    );
    await bridge.callTool("GitHub__create_issue");
    expect(executeSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ toolCallId: expect.any(String) }),
    );
  });
});
