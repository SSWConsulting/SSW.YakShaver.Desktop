import { describe, expect, it, vi } from "vitest";
import type { BridgeToolSummary, ToolCallResult } from "../shared/cli-bridge/protocol";
import { BridgeUnavailableError } from "./bridge-client";
import { callToolViaBridge, listToolsViaBridge } from "./mcp-serve";

/** Read the `text` off the first content item (MCP content is a typed union). */
function firstText(content: Array<{ type: string }>): string | undefined {
  const item = content[0] as { text?: string };
  return item.text;
}

describe("mcp-serve front-door — tools/list proxy", () => {
  it("maps GET /tools summaries to MCP tool descriptors", async () => {
    const summaries: BridgeToolSummary[] = [
      {
        name: "GitHub__create_issue",
        description: "Create a GitHub issue",
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      },
      {
        name: "Internal__fill_template",
        description: "internal",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const get = vi.fn().mockResolvedValue(summaries);

    const result = await listToolsViaBridge({ get });

    expect(get).toHaveBeenCalledWith("/tools");
    expect(result.tools.map((t) => t.name)).toEqual([
      "GitHub__create_issue",
      "Internal__fill_template",
    ]);
    expect(result.tools[0].inputSchema).toMatchObject({ type: "object" });
  });

  it("normalizes a non-object inputSchema to a permissive object schema", async () => {
    const get = vi.fn().mockResolvedValue([
      {
        name: "Weird__tool",
        inputSchema: { type: "string" } as unknown as Record<string, unknown>,
      },
    ]);
    const result = await listToolsViaBridge({ get });
    expect(result.tools[0].inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("collapses a mid-run bridge UNAVAILABILITY to an empty toolset (not a protocol error)", async () => {
    // The app quit/restarted after the front-door was up: the GET throws
    // BridgeUnavailableError. Discovery must not abort the session — it degrades
    // to [] like the bridge router's own never-throw-on-empty contract.
    const get = vi.fn().mockRejectedValue(new BridgeUnavailableError("app not running"));
    const result = await listToolsViaBridge({ get });
    expect(result.tools).toEqual([]);
  });

  it("propagates a non-availability failure (e.g. 401/malformed) rather than masking it as []", async () => {
    // A stale-token 401 or malformed response is a persistent misconfiguration, not
    // a transient dropout — silently returning [] would hide it, so it must surface.
    const get = vi.fn().mockRejectedValue(new Error("unauthorized"));
    await expect(listToolsViaBridge({ get })).rejects.toThrow(/unauthorized/i);
  });
});

describe("mcp-serve front-door — tools/call proxy", () => {
  it("forwards name + arguments to POST /tools/call and returns the result as text content", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: "Created #5" } as ToolCallResult);

    const result = await callToolViaBridge({ post }, "GitHub__create_issue", { title: "Bug" });

    expect(post).toHaveBeenCalledWith("/tools/call", {
      name: "GitHub__create_issue",
      arguments: { title: "Bug" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "Created #5" }]);
  });

  it("forwards shaveId to POST /tools/call when provided (#920, wait-mode per-shave auto-approve)", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: "Created #5" } as ToolCallResult);

    await callToolViaBridge(
      { post },
      "GitHub__create_issue",
      { title: "Bug" },
      undefined,
      "shave-1",
    );

    expect(post).toHaveBeenCalledWith("/tools/call", {
      name: "GitHub__create_issue",
      arguments: { title: "Bug" },
      shaveId: "shave-1",
    });
  });

  it("omits shaveId from the POST body when not provided", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: "Created #5" } as ToolCallResult);

    await callToolViaBridge({ post }, "GitHub__create_issue", { title: "Bug" });

    expect(post).toHaveBeenCalledWith("/tools/call", {
      name: "GitHub__create_issue",
      arguments: { title: "Bug" },
    });
  });

  it("stringifies a non-string tool result", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: { id: 5 } } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "X__y", {});
    expect(firstText(result.content)).toBe(JSON.stringify({ id: 5 }));
  });

  it("relays a native MCP CallToolResult's content verbatim (no double-stringify)", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true,
      result: { content: [{ type: "text", text: "Created #5" }] },
    } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "Created #5" }]);
  });

  it("surfaces an MCP-level isError (auth-denied/rate-limit) as isError, NOT a successful call", async () => {
    // A failed MCP tool resolves WITHOUT throwing, returning { isError: true, content }.
    // The bridge envelope is still ok:true (transport succeeded), so this case is the
    // one that previously leaked an underlying failure to Claude as success.
    const post = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        isError: true,
        content: [{ type: "text", text: "401 Unauthorized: token expired" }],
      },
    } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "401 Unauthorized: token expired" }]);
  });

  it("defaults missing arguments to {}", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: "ok" } as ToolCallResult);
    await callToolViaBridge({ post }, "X__y", undefined);
    expect(post).toHaveBeenCalledWith("/tools/call", { name: "X__y", arguments: {} });
  });

  it("surfaces a structured not-approved result as an MCP isError tool result", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ ok: false, notApproved: true, error: "not approved" } as ToolCallResult);

    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});

    expect(result.isError).toBe(true);
    expect(firstText(result.content)).toMatch(/Tool not approved: not approved/);
  });

  it("surfaces an execution failure as an MCP isError tool result", async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, error: "boom" } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});
    expect(result.isError).toBe(true);
    expect(firstText(result.content)).toMatch(/Tool failed: boom/);
  });

  it("maps a mid-run bridge transport throw to an isError tool result (not a protocol error)", async () => {
    // The bridge became unreachable mid-shave (app quit/socket drop): post() throws.
    // Per MCP, that must reach Claude as a recoverable isError result so it can
    // self-correct — never escape as a JSON-RPC protocol error.
    const post = vi
      .fn()
      .mockRejectedValue(new Error("YakShaver Desktop doesn't appear to be running"));
    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});
    expect(result.isError).toBe(true);
    expect(firstText(result.content)).toMatch(
      /Tool failed: YakShaver Desktop doesn't appear to be running/,
    );
  });
});
