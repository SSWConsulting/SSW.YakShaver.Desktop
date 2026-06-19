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

  it("collects repeated flags into multiOptions while options stays last-write-wins", () => {
    const r = parseArgs(["mcp", "add", "--arg", "a b", "--arg=c", "--arg", "d"]);
    expect(r.multiOptions.arg).toEqual(["a b", "c", "d"]);
    expect(r.options.arg).toBe("d");
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

  it("mcp add stdio collects repeatable --arg values verbatim, preserving spaces", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Local",
      "--transport",
      "stdio",
      "--command",
      "node",
      "--arg",
      "C:\\My Tools\\server.js",
      // A value that itself begins with -- is taken verbatim, no equals form needed.
      "--arg",
      "--config",
      "--arg",
      "My File.json",
    ]);
    expect(req.body).toMatchObject({
      command: "node",
      args: ["C:\\My Tools\\server.js", "--config", "My File.json"],
    });
  });

  it("mcp add stdio passes a flag-shaped --arg value through verbatim (no silent drop)", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Local",
      "--transport",
      "stdio",
      "--command",
      "node",
      "--arg",
      "server.js",
      "--arg",
      "--port",
      "--arg",
      "3000",
    ]);
    expect(req.body).toMatchObject({
      command: "node",
      args: ["server.js", "--port", "3000"],
    });
  });

  it("mcp add stdio supports a single --arg containing spaces via the equals form", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Local",
      "--transport",
      "stdio",
      "--command",
      "node",
      "--arg=C:\\My Tools\\server.js",
    ]);
    expect(req.body).toMatchObject({ args: ["C:\\My Tools\\server.js"] });
  });

  it("mcp add stdio rejects mixing --arg and --args", () => {
    expect(() =>
      build([
        "mcp",
        "add",
        "--name",
        "Local",
        "--transport",
        "stdio",
        "--command",
        "node",
        "--arg",
        "server.js",
        "--args",
        "server.js --port 3000",
      ]),
    ).toThrow(UsageError);
  });

  it("mcp add stdio omits args when neither --arg nor --args is given", () => {
    const req = build([
      "mcp",
      "add",
      "--name",
      "Local",
      "--transport",
      "stdio",
      "--command",
      "node",
    ]);
    expect(req.body).toMatchObject({ args: undefined });
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

  it("mcp update with only --url PUTs only the provided field", () => {
    const req = build(["mcp", "update", "srv-9", "--url", "https://new.example.com/mcp"]);
    expect(req).toMatchObject({ method: "PUT", path: "/mcp/servers/srv-9" });
    expect(req.body).toEqual({ url: "https://new.example.com/mcp" });
  });

  it("mcp update sends ONLY provided fields (no transport unless given)", () => {
    const req = build(["mcp", "update", "srv-9", "--name", "Renamed", "--env", "K=V"]);
    expect(req.body).toEqual({ name: "Renamed", env: { K: "V" } });
  });

  it("mcp update normalizes --transport http to streamableHttp", () => {
    const req = build(["mcp", "update", "srv-9", "--transport", "http"]);
    expect(req.body).toEqual({ transport: "streamableHttp" });
  });

  it("mcp update rejects an unknown transport", () => {
    expect(() => build(["mcp", "update", "srv-9", "--transport", "carrier-pigeon"])).toThrow(
      UsageError,
    );
  });

  it("mcp update with no fields throws a usage error", () => {
    expect(() => build(["mcp", "update", "srv-9"])).toThrow(/No fields to update/);
  });

  it("mcp update without id or --name throws a usage error", () => {
    expect(() => build(["mcp", "update"])).toThrow(UsageError);
  });
});

describe("buildRequest - mcp --name selector", () => {
  it("mcp remove --name sets resolveName and an {id} placeholder path", () => {
    const req = build(["mcp", "remove", "--name", "My Server"]);
    expect(req.method).toBe("DELETE");
    expect(req.path).toBe("/mcp/servers/{id}");
    expect(req.resolveName).toBe("My Server");
  });

  it("mcp enable --name sets resolveName", () => {
    const req = build(["mcp", "enable", "--name", "My Server"]);
    expect(req.path).toBe("/mcp/servers/{id}/enabled");
    expect(req.resolveName).toBe("My Server");
    expect(req.body).toEqual({ enabled: true });
  });

  it("mcp update --name resolves the target and does NOT treat --name as a rename", () => {
    const req = build(["mcp", "update", "--name", "My Server", "--url", "https://x.example/mcp"]);
    expect(req.path).toBe("/mcp/servers/{id}");
    expect(req.resolveName).toBe("My Server");
    // --name was consumed as the selector, so it is NOT in the patch body.
    expect(req.body).toEqual({ url: "https://x.example/mcp" });
  });

  it("mcp update <id> --name treats --name as a rename (id is the selector)", () => {
    const req = build(["mcp", "update", "srv-9", "--name", "Renamed"]);
    expect(req.path).toBe("/mcp/servers/srv-9");
    expect(req.resolveName).toBeUndefined();
    expect(req.body).toEqual({ name: "Renamed" });
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

  it("config get orchestrator -> GET /llm/config", () => {
    expect(build(["config", "get", "orchestrator"])).toMatchObject({
      method: "GET",
      path: "/llm/config",
    });
  });

  it("config set orchestrator --backend local-claude -> POST", () => {
    const req = build(["config", "set", "orchestrator", "--backend", "local-claude"]);
    expect(req).toMatchObject({ method: "POST", path: "/llm/config/orchestrator" });
    expect(req.body).toEqual({ orchestrationBackend: "local-claude" });
  });

  it("config set orchestrator --backend openai -> POST", () => {
    const req = build(["config", "set", "orchestrator", "--backend", "openai"]);
    expect(req.body).toEqual({ orchestrationBackend: "openai" });
  });

  it("config set orchestrator rejects an unknown backend", () => {
    expect(() => build(["config", "set", "orchestrator", "--backend", "gpt5"])).toThrow(
      /--backend must be one of/,
    );
  });

  it("config set orchestrator requires --backend", () => {
    expect(() => build(["config", "set", "orchestrator"])).toThrow(/Missing required --backend/);
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
