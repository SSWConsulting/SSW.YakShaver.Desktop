import { describe, expect, it } from "vitest";
import type { MCPServerConfig } from "../types/mcp";
import { getBuiltinServerIds, getConnectedOrBuiltinIds } from "./mcp-utils";

describe("getBuiltinServerIds", () => {
  it("returns only ids of built-in servers", () => {
    const servers: MCPServerConfig[] = [
      { id: "builtin-1", name: "Built-in Server 1", transport: "inMemory", builtin: true },
      {
        id: "external-1",
        name: "External Server",
        transport: "streamableHttp",
        url: "http://example.com",
      },
      { id: "builtin-2", name: "Built-in Server 2", transport: "inMemory", builtin: true },
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual(["builtin-1", "builtin-2"]);
  });

  it("returns an empty array when there are no built-in servers", () => {
    const servers: MCPServerConfig[] = [
      {
        id: "external-1",
        name: "External Server",
        transport: "streamableHttp",
        url: "http://example.com",
      },
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual([]);
  });

  it("returns an empty array when given an empty server list", () => {
    const result = getBuiltinServerIds([]);

    expect(result).toEqual([]);
  });

  it("excludes servers with missing ids", () => {
    const servers: MCPServerConfig[] = [
      { name: "No ID Server", transport: "inMemory", builtin: true } as unknown as MCPServerConfig,
      {
        id: "builtin-1",
        name: "Built-in Server 1",
        transport: "inMemory",
        builtin: true,
      } as MCPServerConfig,
    ];

    const result = getBuiltinServerIds(servers);

    expect(result).toEqual(["builtin-1"]);
  });
});

describe("getConnectedOrBuiltinIds", () => {
  it("includes built-in and connected servers", () => {
    const servers: MCPServerConfig[] = [
      { id: "builtin-1", name: "Built-in", transport: "inMemory", builtin: true },
      {
        id: "connected-1",
        name: "Connected",
        transport: "streamableHttp",
        url: "http://example.com",
        enabled: true,
      },
      {
        id: "disconnected-1",
        name: "Disconnected",
        transport: "streamableHttp",
        url: "http://example.com",
        enabled: false,
      },
    ];

    const result = getConnectedOrBuiltinIds(servers);

    expect(result).toEqual(new Set(["builtin-1", "connected-1"]));
  });

  it("treats servers without explicit enabled flag as connected", () => {
    const servers: MCPServerConfig[] = [
      {
        id: "implicit-1",
        name: "Implicit",
        transport: "streamableHttp",
        url: "http://example.com",
      },
    ];

    const result = getConnectedOrBuiltinIds(servers);

    expect(result).toEqual(new Set(["implicit-1"]));
  });

  it("returns an empty set when given an empty list", () => {
    expect(getConnectedOrBuiltinIds([])).toEqual(new Set());
  });
});
