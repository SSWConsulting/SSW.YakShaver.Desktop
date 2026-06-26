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
import {
  LocalClaudeOrchestrator,
  type OrchestratorServerManager,
  stripFrontDoorPrefix,
  YAKSHAVER_MCP_SERVER_KEY,
  type YakshaverFrontDoorConfig,
} from "./local-claude-orchestrator";

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

/** A manager mock exposing the new orchestrator surface: the prefixed whitelist + a warm hook. */
function makeManager(whitelist: string[] = []): OrchestratorServerManager {
  return {
    getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(whitelist),
    collectToolsWithServerPrefixAsync: vi.fn().mockResolvedValue({}),
  };
}

function makeSettings(mode: ToolApprovalMode) {
  return { getSettingsAsync: vi.fn().mockResolvedValue({ toolApprovalMode: mode }) };
}

const frontDoor: YakshaverFrontDoorConfig = {
  command: "/path/to/node",
  cliEntryPath: "/app/dist/cli/index.js",
  env: { ELECTRON_RUN_AS_NODE: "1", YAKSHAVER_BRIDGE_PORT: "8765", YAKSHAVER_BRIDGE_TOKEN: "tok" },
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
        makeManager(),
        frontDoor,
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
        makeManager(),
        frontDoor,
        makeSettings("ask"),
        { generateObject: vi.fn() },
      );

      await expect(orch.manualLoopAsync("t", undefined, {})).rejects.toThrow(
        /Claude Code CLI not found on PATH/,
      );
    });
  });

  describe("single-entry yakshaver MCP config (#915 front-door)", () => {
    it("writes ONE mcp server entry: yakshaver -> the mcp-serve front-door", () => {
      const orch = new LocalClaudeOrchestrator();
      const config = orch.buildMcpConfig(frontDoor);

      expect(Object.keys(config.mcpServers)).toEqual([YAKSHAVER_MCP_SERVER_KEY]);
      expect(config.mcpServers.yakshaver).toEqual({
        type: "stdio",
        command: "/path/to/node",
        args: ["/app/dist/cli/index.js", "mcp-serve"],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          YAKSHAVER_BRIDGE_PORT: "8765",
          YAKSHAVER_BRIDGE_TOKEN: "tok",
        },
      });
    });

    it("omits env when the front-door has none", () => {
      const orch = new LocalClaudeOrchestrator();
      const config = orch.buildMcpConfig({
        command: "node",
        cliEntryPath: "/app/dist/cli/index.js",
      });
      expect(config.mcpServers.yakshaver).not.toHaveProperty("env");
    });

    it("re-prefixes the app's whitelist as mcp__yakshaver__<Server__tool>", async () => {
      const orch = new LocalClaudeOrchestrator();
      const manager = makeManager(["GitHub__create_issue", "Internal__fill_template"]);

      const allowed = await orch.buildAllowedTools(manager);

      expect(manager.collectToolsWithServerPrefixAsync).toHaveBeenCalledOnce();
      expect(allowed).toEqual([
        "mcp__yakshaver__GitHub__create_issue",
        "mcp__yakshaver__Internal__fill_template",
      ]);
    });

    it("warming failure is non-fatal; the stored whitelist still applies", async () => {
      const orch = new LocalClaudeOrchestrator();
      const manager: OrchestratorServerManager = {
        getWhitelistWithServerPrefixAsync: vi.fn().mockResolvedValue(["GitHub__create_issue"]),
        collectToolsWithServerPrefixAsync: vi.fn().mockRejectedValue(new Error("no servers")),
      };
      const allowed = await orch.buildAllowedTools(manager);
      expect(allowed).toEqual(["mcp__yakshaver__GitHub__create_issue"]);
    });
  });

  describe("argv building per approval mode", () => {
    it("always passes --strict-mcp-config + the single --mcp-config", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "yolo", []);
      expect(argv).toEqual(
        expect.arrayContaining([
          "-p",
          "--mcp-config",
          "/tmp/cfg.json",
          "--strict-mcp-config",
          "--output-format",
          "stream-json",
          "--verbose",
        ]),
      );
    });

    it("yolo -> --permission-mode bypassPermissions (no --allowedTools)", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "yolo", [
        "mcp__yakshaver__GitHub__create_issue",
      ]);
      expect(argv).toContain("--permission-mode");
      expect(argv).toContain("bypassPermissions");
      expect(argv).not.toContain("--allowedTools");
    });

    it("ask -> --allowedTools built from the yakshaver-prefixed whitelist", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "ask", [
        "mcp__yakshaver__GitHub__create_issue",
        "mcp__yakshaver__Local_FS__read_file",
      ]);
      const idx = argv.indexOf("--allowedTools");
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe(
        "mcp__yakshaver__GitHub__create_issue,mcp__yakshaver__Local_FS__read_file",
      );
      expect(argv).not.toContain("bypassPermissions");
    });

    it("wait with empty whitelist -> no --allowedTools and no bypass (constrained run)", () => {
      const orch = new LocalClaudeOrchestrator();
      const argv = orch.buildArgv("/tmp/cfg.json", "wait", []);
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
                // Real Claude Code stream-json carries an OPAQUE id here, NOT the tool name.
                // Through the single front-door the name is `mcp__yakshaver__<Server>__<tool>`.
                id: "toolu_01ABCdef234567",
                name: "mcp__yakshaver__GitHub__create_issue",
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
                // The result references the tool_use block by its opaque id — never by tool name.
                tool_use_id: "toolu_01ABCdef234567",
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
        makeManager(["GitHub__create_issue"]),
        frontDoor,
        makeSettings("yolo"),
        { generateObject },
      );

      const result = await orch.manualLoopAsync("a bug report", undefined, {
        onStep: (s) => steps.push(s),
      });

      // stdin received the system prompt + transcript
      expect(runChild.stdin.write).toHaveBeenCalled();
      const written = (runChild.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(written).toContain("video transcription: a bug report");

      const types = steps.map((s) => s.type);
      // A `start` step is always emitted first so the Executing Task box is never empty.
      expect(types[0]).toBe("start");
      expect(types).toContain("reasoning");
      expect(types).toContain("tool_call");
      expect(types).toContain("tool_result");
      expect(types).toContain("final_result");

      // Reasoning is wrapped so the UI's <ReasoningStep> (which JSON.parses + renders .text) shows
      // the text instead of a blank box.
      const reasoningStep = steps.find((s) => s.type === "reasoning");
      expect(reasoningStep?.reasoning).toBeDefined();
      expect(JSON.parse(reasoningStep?.reasoning as string)).toMatchObject({
        text: "I'll create an issue.",
      });

      // The single-front-door prefix is stripped from the displayed tool name so it reads as the
      // real `Server__tool` rather than mis-parsing the server as `mcp`.
      const toolCallStep = steps.find((s) => s.type === "tool_call");
      expect(toolCallStep?.toolName).toBe("GitHub__create_issue");

      expect(generateObject).toHaveBeenCalledTimes(1);
      // The judge must see the human-readable tool name (correlated from the opaque tool_use_id),
      // NOT the raw `toolu_...` id — this is the #833 ground-truth signal. Through the front-door
      // the correlated name is the full `mcp__yakshaver__<Server>__<tool>`.
      const judgePrompt = (generateObject as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(judgePrompt).toContain("mcp__yakshaver__GitHub__create_issue");
      expect(judgePrompt).not.toContain("toolu_01ABCdef234567");

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
                tool_use_id: "toolu_01ERRoredcall99",
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
        makeManager(),
        frontDoor,
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
        makeManager(),
        frontDoor,
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
        makeManager(),
        frontDoor,
        makeSettings("yolo"),
        { generateObject: vi.fn() },
      );

      await expect(orch.manualLoopAsync("t", undefined, {})).rejects.toThrow(
        /Claude Code process exited with code 1/,
      );
    });
  });

  describe("stripFrontDoorPrefix", () => {
    it("strips the mcp__yakshaver__ front-door prefix so the real Server__tool remains", () => {
      expect(stripFrontDoorPrefix(`mcp__${YAKSHAVER_MCP_SERVER_KEY}__GitHub__issue_write`)).toBe(
        "GitHub__issue_write",
      );
    });

    it("leaves non-front-door (Claude built-in) tool names unchanged", () => {
      expect(stripFrontDoorPrefix("Read")).toBe("Read");
      expect(stripFrontDoorPrefix("mcp__other__Foo__bar")).toBe("mcp__other__Foo__bar");
    });
  });
});
