import { describe, expect, it, vi } from "vitest";
import type { BridgeToolSummary, ToolCallResult } from "../shared/cli-bridge/protocol";
import { callToolViaBridge, listToolsViaBridge } from "./mcp-serve";

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

  it("stringifies a non-string tool result", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, result: { id: 5 } } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "X__y", {});
    expect(result.content[0].text).toBe(JSON.stringify({ id: 5 }));
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
    expect(result.content[0].text).toMatch(/Tool not approved: not approved/);
  });

  it("surfaces an execution failure as an MCP isError tool result", async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, error: "boom" } as ToolCallResult);
    const result = await callToolViaBridge({ post }, "GitHub__create_issue", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Tool failed: boom/);
  });
});
