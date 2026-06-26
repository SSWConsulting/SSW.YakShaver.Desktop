import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpToolBridge, type ToolBridgeManager, type ToolBridgeSettings } from "./mcp-tool-bridge";

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
  collectToolsWithServerPrefixAsync: ReturnType<typeof vi.fn>;
} {
  return {
    collectToolsWithServerPrefixAsync: vi.fn().mockResolvedValue(tools),
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
  };
}

function makeSettings(mode: "yolo" | "ask" | "wait"): ToolBridgeSettings {
  return { getSettingsAsync: vi.fn().mockResolvedValue({ toolApprovalMode: mode }) };
}

describe("McpToolBridge.listTools", () => {
  it("flattens the aggregated toolset INCLUDING internal servers, with JSON-Schema input", async () => {
    const bridge = new McpToolBridge(makeManager(makeToolSet()), makeSettings("ask"));
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

  it("falls back to a permissive object schema when a tool has no inputSchema", async () => {
    const tools = {
      Bare__tool: { description: "no schema", execute: vi.fn() },
    } as unknown as ToolSet;
    const bridge = new McpToolBridge(makeManager(tools), makeSettings("yolo"));
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
    manager.collectToolsWithServerPrefixAsync.mockRejectedValue(
      new Error("[MCPServerManager]: No MCP clients available"),
    );
    const bridge = new McpToolBridge(manager, makeSettings("ask"));
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
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res).toEqual({ ok: true, result: "Created #5" });
  });

  it("ask: runs a whitelisted tool", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), ["GitHub__create_issue"]),
      makeSettings("ask"),
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });

  it("ask/wait: a NON-whitelisted tool returns a structured not-approved result and does NOT run (no hang)", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), /* whitelist */ []),
      makeSettings("wait"),
    );
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a not-approved failure");
    expect(res.notApproved).toBe(true);
    expect(res.error).toMatch(/not approved/i);
  });

  it("returns a clear error for an unknown tool", async () => {
    const bridge = new McpToolBridge(makeManager(makeToolSet()), makeSettings("yolo"));
    const res = await bridge.callTool("Nope__missing", {});
    expect(res).toEqual({ ok: false, error: "Unknown tool: Nope__missing" });
  });

  it("captures an execute() throw as a structured failure (does not reject)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("boom"));
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: boom }), ["GitHub__create_issue"]),
      makeSettings("ask"),
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
    manager.collectToolsWithServerPrefixAsync.mockRejectedValue(
      new Error("[MCPServerManager]: No tools available from selected/healthy servers"),
    );
    const bridge = new McpToolBridge(manager, makeSettings("yolo"));
    const res = await bridge.callTool("GitHub__create_issue", { title: "Bug" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected a structured failure");
    expect(res.error).toMatch(/unknown tool/i);
  });

  it("defaults arguments to {} and passes them to execute()", async () => {
    const bridge = new McpToolBridge(
      makeManager(makeToolSet({ GitHub__create_issue: executeSpy }), []),
      makeSettings("yolo"),
    );
    await bridge.callTool("GitHub__create_issue");
    expect(executeSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ toolCallId: expect.any(String) }),
    );
  });
});
