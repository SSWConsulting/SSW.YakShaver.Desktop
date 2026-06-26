import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printResult, printServerLine } from "./print";

describe("printResult", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the removed id, not a misleading (unnamed) server line", () => {
    // The DELETE endpoint returns a bare { id, removed: true } envelope.
    printResult("Removed MCP server", { id: "http-1", removed: true }, false);
    const out = logs.join("\n");
    expect(out).toBe("Removed MCP server: http-1");
    // Regression guard: must NOT render the phantom-server line.
    expect(out).not.toContain("(unnamed)");
    expect(out).not.toContain("[?]");
    expect(out).not.toContain("(enabled)");
  });

  it("still pretty-prints a real server object on add", () => {
    printResult(
      "Added MCP server",
      { id: "srv-1", name: "My Server", transport: "stdio", command: "node", enabled: true },
      false,
    );
    const out = logs.join("\n");
    expect(out).toContain("Added MCP server:");
    expect(out).toContain("- My Server [stdio] (enabled)");
    expect(out).toContain("id: srv-1");
  });

  it("emits raw JSON when asJson is true", () => {
    printResult("Removed MCP server", { id: "http-1", removed: true }, true);
    expect(JSON.parse(logs.join("\n"))).toEqual({ id: "http-1", removed: true });
  });
});

describe("printServerLine", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks disabled and built-in servers", () => {
    printServerLine({
      id: "b",
      name: "Built In",
      transport: "inMemory",
      enabled: false,
      builtin: true,
    });
    const out = logs.join("\n");
    expect(out).toContain("- Built In [inMemory] (disabled) [builtin]");
  });
});
