import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The orchestrator pulls electron in transitively via LanguageModelProvider; stub it so the
// real control flow runs in a plain node test environment.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));
vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import type { MCPStep } from "../../../shared/types/mcp";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";
// vi.mock calls above are hoisted, so this static import sees the stubbed modules.
import { LocalClaudeOrchestrator } from "./local-claude-orchestrator";
import type { MCPServerConfig } from "./types";

type MockChild = ChildProcess & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
};

function createMockChild(): MockChild {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  return proc as unknown as MockChild;
}

/**
 * A spawner that returns a `--version` child first (success), then the run child. The run child's
 * scripted stream is emitted right after the run child is returned (a tick later), guaranteeing the
 * orchestrator has attached its stdout/close listeners before any event fires — no race.
 */
function makeSpawner(versionExitCode: number, runChild: MockChild, runScript?: () => void) {
  const versionChild = createMockChild();
  const spawn = vi.fn((_cmd: string, args: string[]) => {
    if (args.includes("--version")) {
      setImmediate(() => versionChild.emit("close", versionExitCode));
      return versionChild;
    }
    if (runScript) setImmediate(runScript);
    return runChild;
  });
  return { spawn };
}

function makeManager(servers: MCPServerConfig[]) {
  return { listAvailableServers: vi.fn().mockResolvedValue(servers) };
}

function makeSettings(mode: ToolApprovalMode) {
  return { getSettingsAsync: vi.fn().mockResolvedValue({ toolApprovalMode: mode }) };
}

function makeTokenStorage(tokenByServer: Record<string, string> = {}) {
  return {
    getTokensAsync: vi.fn(async (serverId: string) =>
      tokenByServer[serverId] ? { access_token: tokenByServer[serverId] } : undefined,
    ),
  };
}

const httpServer: MCPServerConfig = {
  id: "gh-1",
  name: "GitHub",
  transport: "streamableHttp",
  url: "https://mcp.github.test/",
  toolWhitelist: ["create_issue"],
  enabled: true,
};

const stdioServer: MCPServerConfig = {
  id: "fs-1",
  name: "Local FS",
  transport: "stdio",
  command: "npx",
  args: ["-y", "fs-mcp"],
  env: { FOO: "bar" },
  toolWhitelist: ["read_file"],
  enabled: true,
};

describe("LocalClaudeOrchestrator", () => {
  let runChild: MockChild;

  beforeEach(() => {
    runChild = createMockChild();
  });

  describe("claude availability", () => {
    it("throws a clear error when `claude` is not found (--version fails)", async () => {
      const { spawn } = makeSpawner(/* versionExitCode */ 127, runChild);
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([]),
        makeTokenStorage(),
        makeSettings("ask"),
        { generateObject: vi.fn() },
      );

      await expect(orch.manualLoopAsync("transcript", undefined, {})).rejects.toThrow(
        /Claude Code CLI not found on PATH/,
      );
    });

    it("throws a clear error when spawning `claude --version` errors (ENOENT)", async () => {
      const versionChild = createMockChild();
      const spawn = vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("--version")) {
          setImmediate(() => versionChild.emit("error", new Error("spawn ENOENT")));
          return versionChild;
        }
        return runChild;
      });
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([]),
        makeTokenStorage(),
        makeSettings("ask"),
        { generateObject: vi.fn() },
      );

      await expect(orch.manualLoopAsync("t", undefined, {})).rejects.toThrow(
        /Claude Code CLI not found on PATH/,
      );
    });
  });

  describe("MCP config serialization", () => {
    it("serializes stdio (command/args/env) and http (url + injected bearer token)", async () => {
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn: vi.fn() },
        makeManager([stdioServer, httpServer]),
        makeTokenStorage({ "gh-1": "tok-123" }),
        makeSettings("ask"),
        { generateObject: vi.fn() },
      );

      const { mcpConfig, allowedTools } = await orch.serializeMcpServers(
        makeManager([stdioServer, httpServer]),
        undefined,
      );

      expect(mcpConfig.mcpServers).toEqual({
        Local_FS: {
          type: "stdio",
          command: "npx",
          args: ["-y", "fs-mcp"],
          env: { FOO: "bar" },
        },
        GitHub: {
          type: "http",
          url: "https://mcp.github.test/",
          headers: { Authorization: "Bearer tok-123" },
        },
      });
      expect(allowedTools).toEqual(["mcp__Local_FS__read_file", "mcp__GitHub__create_issue"]);
    });

    it("respects the serverFilter and skips disabled + inMemory servers", async () => {
      const disabled: MCPServerConfig = { ...stdioServer, id: "off", name: "Off", enabled: false };
      const internal: MCPServerConfig = {
        id: "in",
        name: "Internal",
        transport: "inMemory",
        enabled: true,
      };
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn: vi.fn() },
        null,
        makeTokenStorage(),
      );
      const mgr = makeManager([stdioServer, httpServer, disabled, internal]);

      const { mcpConfig } = await orch.serializeMcpServers(mgr, ["gh-1"]);
      expect(Object.keys(mcpConfig.mcpServers)).toEqual(["GitHub"]);
    });

    it("flags servers with no whitelist (under ask/wait) instead of hanging", async () => {
      const noWhitelist: MCPServerConfig = { ...httpServer, toolWhitelist: [] };
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn: vi.fn() },
        null,
        makeTokenStorage(),
      );
      const { skippedNonWhitelistedServers, allowedTools } = await orch.serializeMcpServers(
        makeManager([noWhitelist]),
        undefined,
      );
      expect(skippedNonWhitelistedServers).toEqual(["GitHub"]);
      expect(allowedTools).toEqual([]);
    });
  });

  describe("argv building per approval mode", () => {
    it("always passes the serialized config strictly + the system prompt file", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "/tmp/sys.txt", "yolo", []);
      // --strict-mcp-config keeps the run to YakShaver's servers only (no ambient .mcp.json).
      expect(argv).toContain("--strict-mcp-config");
      // The orchestrator role is delivered as the system prompt, not as the user turn.
      const sysIdx = argv.indexOf("--system-prompt-file");
      expect(sysIdx).toBeGreaterThan(-1);
      expect(argv[sysIdx + 1]).toBe("/tmp/sys.txt");
      expect(argv).toEqual(
        expect.arrayContaining([
          "-p",
          "--mcp-config",
          "/tmp/cfg.json",
          "--output-format",
          "stream-json",
          "--verbose",
        ]),
      );
    });

    it("yolo -> --permission-mode bypassPermissions (no --allowedTools)", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "/tmp/sys.txt", "yolo", [
        "mcp__GitHub__create_issue",
      ]);
      expect(argv).toContain("--permission-mode");
      expect(argv).toContain("bypassPermissions");
      expect(argv).not.toContain("--allowedTools");
    });

    it("wait -> --permission-mode bypassPermissions (matches OpenAI's auto-approve-after-delay)", () => {
      const orch = new LocalClaudeOrchestrator();
      // wait auto-approves non-whitelisted tools after a delay on the OpenAI path; the headless
      // analogue that still RUNS them is bypassPermissions, not a hard deny.
      const argv = orch.buildArgv("/tmp/cfg.json", "/tmp/sys.txt", "wait", []);
      expect(argv).toContain("--permission-mode");
      expect(argv).toContain("bypassPermissions");
      expect(argv).not.toContain("--allowedTools");
      expect(argv).not.toContain("dontAsk");
    });

    it("ask -> --permission-mode dontAsk + --allowedTools (denies non-whitelisted, never hangs)", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "/tmp/sys.txt", "ask", [
        "mcp__GitHub__create_issue",
        "mcp__Local_FS__read_file",
      ]);
      // dontAsk converts any approval prompt into a denial so a headless run can't block.
      const pmIdx = argv.indexOf("--permission-mode");
      expect(pmIdx).toBeGreaterThan(-1);
      expect(argv[pmIdx + 1]).toBe("dontAsk");
      const idx = argv.indexOf("--allowedTools");
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe("mcp__GitHub__create_issue,mcp__Local_FS__read_file");
      expect(argv).not.toContain("bypassPermissions");
    });

    it("ask with empty whitelist -> dontAsk and no --allowedTools (no MCP tools run, no hang)", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "/tmp/sys.txt", "ask", []);
      expect(argv).toContain("dontAsk");
      expect(argv).not.toContain("--allowedTools");
      expect(argv).not.toContain("bypassPermissions");
    });
  });

  describe("stream-json parsing -> MCPStep sequence + judge", () => {
    /** Builds a closure that emits the given newline-delimited JSON lines then closes the child. */
    function streamScript(child: MockChild, lines: string[], exitCode = 0) {
      return () => {
        for (const line of lines) {
          child.stdout?.emit("data", Buffer.from(`${line}\n`));
        }
        child.emit("close", exitCode);
      };
    }

    it("maps assistant text/tool_use and user tool_result to MCPStep, then judges achieved", async () => {
      const steps: MCPStep[] = [];
      const generateObject = vi.fn().mockResolvedValue({
        achieved: true,
        artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/5" }],
        reasoning: "created",
      });

      // Realistic stream: the tool_use block carries an OPAQUE id; the tool_result references it
      // only via tool_use_id (NOT the tool name). The orchestrator must correlate id -> name.
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "I'll create an issue." }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_01ABCdef",
                name: "mcp__GitHub__create_issue",
                input: { title: "Bug" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_01ABCdef",
                content: "Created issue #5: https://github.com/o/r/issues/5",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Done! Created issue #5.",
        }),
      ];

      const { spawn } = makeSpawner(0, runChild, streamScript(runChild, lines));
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([httpServer]),
        makeTokenStorage({ "gh-1": "tok" }),
        makeSettings("yolo"),
        { generateObject },
      );

      const result = await orch.manualLoopAsync("a bug report", undefined, {
        onStep: (s) => steps.push(s),
      });

      // stdin received only the transcript as the user turn (the system prompt goes via argv).
      expect(runChild.stdin.write).toHaveBeenCalled();
      const written = (runChild.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(written).toContain("video transcription: a bug report");

      const types = steps.map((s) => s.type);
      expect(types).toContain("reasoning");
      expect(types).toContain("tool_call");
      expect(types).toContain("tool_result");
      expect(types).toContain("final_result");

      // Reasoning is emitted JSON-encoded ({type,text}) so ReasoningStep renders it (not blank).
      const reasoningStep = steps.find((s) => s.type === "reasoning");
      expect(JSON.parse(reasoningStep?.reasoning ?? "{}")).toEqual({
        type: "text",
        text: "I'll create an issue.",
      });

      // The judge must receive the REAL tool name, correlated from the opaque tool_use_id — not
      // the opaque `toolu_...` id itself.
      const judgePrompt = generateObject.mock.calls[0][0] as string;
      expect(judgePrompt).toContain("mcp__GitHub__create_issue");
      expect(judgePrompt).not.toContain("toolu_01ABCdef");

      expect(generateObject).toHaveBeenCalledTimes(1);
      expect(result.backlogActionSucceeded).toBe(true);
      expect(result.terminationReason).toBe("stop");
      expect(result.artifacts).toEqual([
        { type: "issue", idOrUrl: "https://github.com/o/r/issues/5" },
      ]);
      expect(result.text).toBe("Done! Created issue #5.");
    });

    it("an errored tool_result is recorded as not-ok, so the judge is not consulted -> not achieved", async () => {
      const generateObject = vi.fn();
      const lines = [
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "mcp__GitHub__create_issue",
                is_error: true,
                content: "401 Unauthorized",
              },
            ],
          },
        }),
        JSON.stringify({ type: "result", subtype: "success", result: "Could not create." }),
      ];
      const { spawn } = makeSpawner(0, runChild, streamScript(runChild, lines));
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([httpServer]),
        makeTokenStorage(),
        makeSettings("yolo"),
        { generateObject },
      );

      const result = await orch.manualLoopAsync("t", undefined, {});
      expect(generateObject).not.toHaveBeenCalled();
      expect(result.backlogActionSucceeded).toBe(false);
    });

    it("error_max_turns subtype -> terminationReason max-iterations", async () => {
      const lines = [JSON.stringify({ type: "result", subtype: "error_max_turns", result: "" })];
      const { spawn } = makeSpawner(0, runChild, streamScript(runChild, lines));
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([]),
        makeTokenStorage(),
        makeSettings("yolo"),
        { generateObject: vi.fn() },
      );

      const result = await orch.manualLoopAsync("t", undefined, {});
      expect(result.terminationReason).toBe("max-iterations");
    });

    it("rejects when the process exits non-zero before any result event", async () => {
      const failScript = () => {
        runChild.stderr?.emit("data", Buffer.from("boom"));
        runChild.emit("close", 1);
      };
      const { spawn } = makeSpawner(0, runChild, failScript);
      const orch = new LocalClaudeOrchestrator(
        "claude",
        { spawn },
        makeManager([]),
        makeTokenStorage(),
        makeSettings("yolo"),
        { generateObject: vi.fn() },
      );

      await expect(orch.manualLoopAsync("t", undefined, {})).rejects.toThrow(
        /Claude Code process exited with code 1/,
      );
    });
  });
});
