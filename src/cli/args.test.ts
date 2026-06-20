import { describe, expect, it } from "vitest";
import { ArgParseError, parseArgs } from "./args";

describe("parseArgs", () => {
  it("splits positionals from options", () => {
    const r = parseArgs(["mcp", "add", "--name", "Foo", "--transport", "stdio"]);
    expect(r.positionals).toEqual(["mcp", "add"]);
    expect(r.options).toMatchObject({ name: "Foo", transport: "stdio" });
  });

  it("supports --key=value", () => {
    const r = parseArgs(["mcp", "add", "--name=Foo Bar"]);
    expect(r.options.name).toBe("Foo Bar");
  });

  it("treats known boolean flags and trailing flags as boolean", () => {
    const r = parseArgs(["mcp", "enable", "abc", "--off"]);
    expect(r.options.off).toBe(true);
    expect(r.positionals).toEqual(["mcp", "enable", "abc"]);
  });

  it("collects repeated flags into multiOptions; options stays last-write-wins", () => {
    const r = parseArgs(["mcp", "add", "--arg", "a b", "--arg=c", "--arg", "d"]);
    expect(r.multiOptions.arg).toEqual(["a b", "c", "d"]);
    expect(r.options.arg).toBe("d");
  });

  describe("--arg is a value-flag (takes its next token verbatim)", () => {
    it("takes a value-shaped token", () => {
      const r = parseArgs(["--arg", "one", "--arg", "three"]);
      expect(r.multiOptions.arg).toEqual(["one", "three"]);
    });

    it("takes a flag-shaped (--prefixed) token verbatim instead of dropping it", () => {
      // Regression: previously `--arg --flag` silently dropped "--flag" and set
      // options.flag = true, launching a misconfigured MCP server with no error.
      const r = parseArgs(["--arg", "one", "--arg", "--flag", "--arg", "three"]);
      expect(r.multiOptions.arg).toEqual(["one", "--flag", "three"]);
      expect(r.options.flag).toBeUndefined();
    });

    it("supports the natural `--arg --port --arg 3000` form", () => {
      const r = parseArgs(["--arg", "--port", "--arg", "3000"]);
      expect(r.multiOptions.arg).toEqual(["--port", "3000"]);
    });

    it("throws ArgParseError when --arg has no following value", () => {
      expect(() => parseArgs(["mcp", "add", "--command", "node", "--arg"])).toThrow(ArgParseError);
    });

    it("still supports the equals form for a --prefixed value", () => {
      const r = parseArgs(["--arg=--config=My File.json"]);
      expect(r.multiOptions.arg).toEqual(["--config=My File.json"]);
    });
  });
});
