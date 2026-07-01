import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type ClaudeReadinessDeps,
  checkClaudeReadiness,
  detectClaudeAuth,
  resolveCredentialsPath,
} from "./claude-readiness";

/** A spawner whose `claude --version` child closes with the given exit code (or emits an error). */
function makeSpawner(opts: {
  versionExitCode?: number;
  spawnError?: boolean;
  emitError?: boolean;
}) {
  const spawn = vi.fn((_cmd: string, _args: string[]) => {
    if (opts.spawnError) throw new Error("spawn failed");
    const child = new EventEmitter() as unknown as ChildProcess;
    setImmediate(() => {
      if (opts.emitError) child.emit("error", new Error("ENOENT"));
      else child.emit("close", opts.versionExitCode ?? 0);
    });
    return child;
  });
  return { spawn };
}

function makeDeps(overrides: Partial<ClaudeReadinessDeps> = {}): ClaudeReadinessDeps {
  return {
    spawner: makeSpawner({ versionExitCode: 0 }),
    env: {},
    fileExists: () => false,
    homeDir: () => "/home/test",
    claudeCommand: "claude",
    ...overrides,
  };
}

describe("resolveCredentialsPath", () => {
  it("uses CLAUDE_CONFIG_DIR when set", () => {
    expect(resolveCredentialsPath({ CLAUDE_CONFIG_DIR: "/custom/dir" }, () => "/home/test")).toBe(
      join("/custom/dir", ".credentials.json"),
    );
  });

  it("falls back to <home>/.claude when CLAUDE_CONFIG_DIR is unset/blank", () => {
    expect(resolveCredentialsPath({ CLAUDE_CONFIG_DIR: "  " }, () => "/home/test")).toBe(
      join("/home/test", ".claude", ".credentials.json"),
    );
  });
});

describe("detectClaudeAuth", () => {
  it("is true when an auth env var is set", () => {
    const deps = makeDeps();
    expect(detectClaudeAuth({ ANTHROPIC_API_KEY: "sk-123" }, deps)).toBe(true);
    expect(detectClaudeAuth({ CLAUDE_CODE_OAUTH_TOKEN: "tok" }, deps)).toBe(true);
  });

  it("ignores blank/whitespace env values", () => {
    expect(detectClaudeAuth({ ANTHROPIC_API_KEY: "   " }, makeDeps())).toBe(false);
  });

  it("is true when the credentials file exists", () => {
    const credsPath = join("/home/test", ".claude", ".credentials.json");
    const deps = makeDeps({ fileExists: (p) => p === credsPath });
    expect(detectClaudeAuth({}, deps)).toBe(true);
  });

  it("is false with no env and no credentials file", () => {
    expect(detectClaudeAuth({}, makeDeps())).toBe(false);
  });
});

describe("checkClaudeReadiness", () => {
  it("reports not-installed when `claude --version` exits non-zero", async () => {
    const r = await checkClaudeReadiness(
      makeDeps({ spawner: makeSpawner({ versionExitCode: 127 }) }),
    );
    expect(r).toMatchObject({ installed: false, ready: false, state: "not-installed" });
    expect(r.message).toMatch(/not found on PATH/i);
  });

  it("reports not-installed when spawning errors (ENOENT)", async () => {
    const r = await checkClaudeReadiness(makeDeps({ spawner: makeSpawner({ emitError: true }) }));
    expect(r.state).toBe("not-installed");
  });

  it("reports not-installed when spawn throws synchronously", async () => {
    const r = await checkClaudeReadiness(makeDeps({ spawner: makeSpawner({ spawnError: true }) }));
    expect(r.state).toBe("not-installed");
  });

  it("reports not-authenticated when installed but no credentials", async () => {
    const r = await checkClaudeReadiness(
      makeDeps({ spawner: makeSpawner({ versionExitCode: 0 }) }),
    );
    expect(r).toMatchObject({ installed: true, authenticated: false, ready: false });
    expect(r.state).toBe("not-authenticated");
    expect(r.message).toMatch(/not signed in/i);
  });

  it("reports ready when installed and an auth env var is present", async () => {
    const r = await checkClaudeReadiness(
      makeDeps({ spawner: makeSpawner({ versionExitCode: 0 }), env: { ANTHROPIC_API_KEY: "sk" } }),
    );
    expect(r).toEqual({
      installed: true,
      authenticated: true,
      ready: true,
      state: "ready",
      message: "",
    });
  });

  it("reports ready when installed and a credentials file exists", async () => {
    const credsPath = join("/home/test", ".claude", ".credentials.json");
    const r = await checkClaudeReadiness(
      makeDeps({
        spawner: makeSpawner({ versionExitCode: 0 }),
        fileExists: (p) => p === credsPath,
      }),
    );
    expect(r.ready).toBe(true);
  });
});
