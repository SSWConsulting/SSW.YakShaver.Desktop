import type { MCPServerConfig } from "../types/mcp";
import { describe, expect, it } from "vitest";
import { getBuiltinServerIds } from "./mcp-utils";

describe("getBuiltinServerIds", () => {
  it("returns only ids of built-in servers", () => {
    const servers: MCPServerConfig[] = [
      { id: "builtin-1", name: "Built-in Server 1", transport: "inMemory", builtin: true },
      { id: "external-1", name: "External Server", transport: "streamableHttp", url: "http://example.com" },
      { id: "builtin-2", name: "Built-in Server 2", transport: "inMemory", builtin: true },
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual(["builtin-1", "builtin-2"]);
  });

  it("returns an empty array when there are no built-in servers", () => {
    const servers: MCPServerConfig[] = [
      { id: "external-1", name: "External Server", transport: "streamableHttp", url: "http://example.com" },
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual([]);
  });

  it("returns an empty array when given an empty server list", () => {
    const result = getBuiltinServerIds([]);

    expect(result).toEqual([]);
  });

  it("excludes servers with missing ids", () => {
    const servers = [
      // biome-ignore lint/suspicious/noExplicitAny: Testing edge case where id may be missing
      { name: "No ID Server", transport: "inMemory", builtin: true } as any as MCPServerConfig,
      { id: "builtin-1", name: "Built-in Server 1", transport: "inMemory", builtin: true },
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual(["builtin-1"]);
  });
});
