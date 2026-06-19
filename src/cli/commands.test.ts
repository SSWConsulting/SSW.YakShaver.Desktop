import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";
import { buildRequest, UsageError } from "./commands";

function build(argv: string[]) {
  return buildRequest(parseArgs(argv));
}

describe("parseArgs", () => {
  it("splits positionals and options", () => {
    const r = parseArgs(["mcp", "add", "--name", "Foo", "--transport", "stdio"]);
    expect(r.positionals).toEqual(["mcp", "add"]);
    expect(r.options).toEqual({ name: "Foo", transport: "stdio" });
  });

  it("supports --key=value", () => {
    const r = parseArgs(["mcp", "add", "--name=Foo Bar"]);
    expect(r.options.name).toBe("Foo Bar");
  });

  it("treats trailing/known flags as boolean", () => {
    const r = parseArgs(["mcp", "enable", "abc", "--off"]);
    expect(r.options.off).toBe(true);
    expect(r.positionals).toEqual(["mcp", "enable", "abc"]);
  });
});

describe("buildRequest - mcp", () => {
  it("mcp list -> GET /mcp/servers", () => {
    expect(build(["mcp", "list"])).toMatchObject({ method: "GET", path: "/mcp/servers" });
  });

  it("mcp add stdio builds a POST with command + args + env", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Local",
      "--transport",
      "stdio",
      "--command",
      "node",
      "--args",
      "server.js --port 3000",
      "--env",
      "API_KEY=abc,DEBUG=1",
    ]);
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/mcp/servers");
    expect(req.body).toEqual({
      name: "Local",
      description: undefined,
      transport: "stdio",
      command: "node",
      args: ["server.js", "--port", "3000"],
      env: { API_KEY: "abc", DEBUG: "1" },
    });
  });

  it("mcp add http builds a POST with url + headers", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Remote",
      "--transport",
      "http",
      "--url",
      "https://example.com/mcp",
      "--header",
      "Authorization=Bearer xyz",
    ]);
    expect(req.body).toMatchObject({
      transport: "streamableHttp",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer xyz" },
    });
  });

  it("mcp add throws when required option missing", () => {
    expect(() => build(["mcp", "add", "--transport", "stdio"])).toThrow(/Missing required --name/);
    expect(() => build(["mcp", "add", "--name", "X", "--transport", "stdio"])).toThrow(
      /Missing required --command/,
    );
  });

  it("mcp add rejects unknown transport", () => {
    expect(() => build(["mcp", "add", "--name", "X", "--transport", "carrier-pigeon"])).toThrow(
      UsageError,
    );
  });

  it("mcp remove <id> -> DELETE", () => {
    expect(build(["mcp", "remove", "srv-9"])).toMatchObject({
      method: "DELETE",
      path: "/mcp/servers/srv-9",
    });
  });

  it("mcp remove without id throws usage error", () => {
    expect(() => build(["mcp", "remove"])).toThrow(UsageError);
  });

  it("mcp enable <id> -> POST enabled:true", () => {
    expect(build(["mcp", "enable", "srv-9"])).toMatchObject({
      method: "POST",
      path: "/mcp/servers/srv-9/enabled",
      body: { enabled: true },
    });
  });

  it("mcp enable <id> --off -> POST enabled:false", () => {
    expect(build(["mcp", "enable", "srv-9", "--off"])).toMatchObject({
      body: { enabled: false },
    });
  });

  it("url-encodes ids with special chars", () => {
    expect(build(["mcp", "remove", "a/b c"]).path).toBe("/mcp/servers/a%2Fb%20c");
  });
});

describe("buildRequest - config", () => {
  it("config get llm -> GET /llm/config", () => {
    expect(build(["config", "get", "llm"])).toMatchObject({ method: "GET", path: "/llm/config" });
  });

  it("config get defaults to settings", () => {
    expect(build(["config", "get"])).toMatchObject({ method: "GET", path: "/settings" });
  });

  it("config set settings builds a PATCH patch", () => {
    const req = build([
      "config",
      "set",
      "settings",
      "--tool-approval-mode",
      "yolo",
      "--open-at-login",
      "true",
    ]);
    expect(req.method).toBe("PATCH");
    expect(req.path).toBe("/settings");
    expect(req.body).toEqual({ toolApprovalMode: "yolo", openAtLogin: true });
  });

  it("config set settings with no fields throws usage error", () => {
    expect(() => build(["config", "set", "settings"])).toThrow(UsageError);
  });

  it("config set llm is unsupported", () => {
    expect(() => build(["config", "set", "llm"])).toThrow(/not supported/);
  });
});

describe("buildRequest - errors", () => {
  it("unknown top-level command throws UsageError", () => {
    expect(() => build(["frobnicate"])).toThrow(UsageError);
  });
  it("unknown mcp subcommand throws UsageError", () => {
    expect(() => build(["mcp", "wat"])).toThrow(UsageError);
  });
});
