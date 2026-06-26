import { describe, expect, it } from "vitest";
import { UsageError } from "./commands";
import { resolveServerIdByName } from "./resolve-name";

describe("resolveServerIdByName", () => {
  const servers = [
    { id: "srv-1", name: "Alpha" },
    { id: "srv-2", name: "Beta" },
    { id: "srv-3", name: "Beta" }, // duplicate name -> ambiguous
  ];

  it("resolves a unique name to its id", () => {
    expect(resolveServerIdByName(servers, "Alpha")).toBe("srv-1");
  });

  it("throws a UsageError when no server matches", () => {
    expect(() => resolveServerIdByName(servers, "Gamma")).toThrow(UsageError);
    expect(() => resolveServerIdByName(servers, "Gamma")).toThrow(/No MCP server found/);
  });

  it("throws a UsageError listing ids when the name is ambiguous", () => {
    expect(() => resolveServerIdByName(servers, "Beta")).toThrow(/Multiple MCP servers match/);
    expect(() => resolveServerIdByName(servers, "Beta")).toThrow(/srv-2, srv-3/);
  });

  it("treats a non-array input as empty (no match)", () => {
    expect(() => resolveServerIdByName(null, "Alpha")).toThrow(/No MCP server found/);
  });

  it("rejects a matched server that has no usable id", () => {
    expect(() => resolveServerIdByName([{ name: "Alpha" }], "Alpha")).toThrow(/no usable id/);
  });
});
