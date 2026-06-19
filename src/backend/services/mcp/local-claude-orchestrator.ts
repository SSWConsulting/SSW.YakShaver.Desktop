import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";
import { getDurationParts } from "../../utils/duration-utils";
import type { VideoUploadResult } from "../auth/types";
import { UserSettingsStorage } from "../storage/user-settings-storage";
import {
  type IBacklogOrchestrator,
  judgeBacklogOutcome,
  type ManualLoopOptions,
  type MCPLoopResult,
  type MCPTerminationReason,
  type OutcomeJudgeProvider,
  type ToolActivity,
} from "./backlog-orchestrator";
import { LanguageModelProvider } from "./language-model-provider";
import { MCPServerManager } from "./mcp-server-manager";
import { orchestratorSystemPrompt } from "./prompts";

/**
 * Spawner abstraction mirroring ffmpeg-service's `IProcessSpawner`, kept here so the unit tests
 * can inject a mock child process and assert on the exact argv without ever running `claude`.
 */
export interface IClaudeProcessSpawner {
  spawn(command: string, args: string[]): ChildProcess;
}

const defaultClaudeSpawner: IClaudeProcessSpawner = {
  spawn: (command, args) => spawn(command, args),
};

/** Claude Code's `--mcp-config` JSON entry for one stdio server. */
interface ClaudeStdioServer {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Claude Code's `--mcp-config` JSON entry for one HTTP server. */
interface ClaudeHttpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

type ClaudeMcpServer = ClaudeStdioServer | ClaudeHttpServer;

export interface ClaudeMcpConfigFile {
  mcpServers: Record<string, ClaudeMcpServer>;
}

/** Fixed MCP server key for the single front-door. Tools appear as `mcp__yakshaver__<Server__tool>`. */
export const YAKSHAVER_MCP_SERVER_KEY = "yakshaver";

/**
 * How to spawn the single `yakshaver mcp-serve` front-door (#915), and how the
 * spawned process reaches the running app's bridge.
 *
 * Injectable so the argv/config unit tests stay pure (no Electron `app`, no
 * `process.execPath`, no live bridge). The real value is resolved from the
 * Electron app + the running {@link CliBridgeServer} at call time.
 */
export interface YakshaverFrontDoorConfig {
  /** Executable that runs the CLI (Electron-as-node in prod, or `node` in tests). */
  command: string;
  /** Path to the built CLI entry (`dist/cli/index.js`). The `mcp-serve` arg is appended. */
  cliEntryPath: string;
  /** Extra env to pass to the front-door process (bridge port/token, ELECTRON_RUN_AS_NODE). */
  env?: Record<string, string>;
}

/**
 * The MCPServerManager surface the orchestrator now needs: the prefixed whitelist (authoritative
 * client-side gate) plus an optional tool-collection call to warm the internal clients so built-in
 * tools are reflected in the whitelist.
 */
export type OrchestratorServerManager = Pick<
  MCPServerManager,
  "getWhitelistWithServerPrefixAsync"
> &
  Partial<Pick<MCPServerManager, "collectToolsWithServerPrefixAsync">>;

/**
 * Drives the backlog-creation step with a local headless `claude -p` process instead of the
 * in-process OpenAI loop.
 *
 * As of #915 it no longer serializes each MCP server (and skips internal ones); instead it writes
 * a SINGLE `--mcp-config` entry — the `yakshaver` MCP front-door — which proxies the app's full
 * aggregated toolset (including internal/in-memory servers) over the localhost bridge. It still
 * maps the tool-approval mode to Claude's permission flags, streams `stream-json` events to
 * `onStep`, and reuses the shared `judgeBacklogOutcome` on the collected tool results.
 */
export class LocalClaudeOrchestrator implements IBacklogOrchestrator {
  // Storage deps are resolved lazily — only when actually needed — so constructing the orchestrator
  // (and the argv/serialization unit tests that do) never touches the electron-backed singletons.
  constructor(
    private readonly claudeCommand: string = "claude",
    private readonly spawner: IClaudeProcessSpawner = defaultClaudeSpawner,
    private readonly serverManager: OrchestratorServerManager | null = null,
    private readonly frontDoor: YakshaverFrontDoorConfig | null = null,
    private readonly settingsStorage: Pick<UserSettingsStorage, "getSettingsAsync"> | null = null,
    private readonly judgeProvider: OutcomeJudgeProvider | null = null,
  ) {}

  private getSettingsStorage(): Pick<UserSettingsStorage, "getSettingsAsync"> {
    return this.settingsStorage ?? UserSettingsStorage.getInstance();
  }

  /** Verifies the `claude` CLI is reachable; throws a user-actionable error if not. */
  public async ensureClaudeAvailable(): Promise<void> {
    const detected = await new Promise<boolean>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawner.spawn(this.claudeCommand, ["--version"]);
      } catch {
        resolve(false);
        return;
      }
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });

    if (!detected) {
      throw new Error(
        "Claude Code CLI not found on PATH — install it, or switch Orchestrator to OpenAI in Settings.",
      );
    }
  }

  public async manualLoopAsync(
    videoTranscription: string,
    videoUploadResult?: VideoUploadResult,
    options: ManualLoopOptions = {},
  ): Promise<MCPLoopResult> {
    await this.ensureClaudeAvailable();

    const manager = this.serverManager ?? (await MCPServerManager.getInstanceAsync());
    const frontDoor = this.frontDoor ?? (await resolveFrontDoorConfig());
    const approvalMode = (await this.getSettingsStorage().getSettingsAsync()).toolApprovalMode;

    const systemPrompt = this.buildSystemPrompt(
      options.projectMetaData,
      options.desktopAgentProjectPrompt,
      videoUploadResult,
      options.videoFilePath,
    );

    const mcpConfig = this.buildMcpConfig(frontDoor);
    const allowedTools = await this.buildAllowedTools(manager);

    if (approvalMode !== "yolo" && allowedTools.length === 0) {
      console.warn(
        `[LocalClaudeOrchestrator] No whitelisted tools under "${approvalMode}" approval mode — Claude will be constrained to the built-in tools the app always permits. Whitelist tools or use "yolo" to allow more.`,
      );
    }

    const tmpConfigPath = join(tmpdir(), `yakshaver-mcp-${randomUUID()}.json`);
    await fs.writeFile(tmpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf8");

    try {
      const argv = this.buildArgv(tmpConfigPath, approvalMode, allowedTools);
      return await this.runClaude(argv, systemPrompt, videoTranscription, options);
    } finally {
      await fs.unlink(tmpConfigPath).catch(() => {
        /* best-effort cleanup */
      });
    }
  }

  /**
   * Builds the system prompt the same way `MCPOrchestrator` does: base orchestrator prompt +
   * project metadata + project prompt + video info.
   */
  private buildSystemPrompt(
    projectMetaData?: string,
    desktopAgentProjectPrompt?: string,
    videoUploadResult?: VideoUploadResult,
    videoFilePath?: string,
  ): string {
    let systemPrompt = orchestratorSystemPrompt;

    systemPrompt += projectMetaData ? `\n---\nProject Metadata:\n${projectMetaData}` : "";
    systemPrompt += desktopAgentProjectPrompt
      ? `\n---\nProject Prompt:\n${desktopAgentProjectPrompt}`
      : "";

    const videoUrl = videoUploadResult?.data?.url;
    const duration = videoUploadResult?.data?.duration;
    if (videoUrl) {
      const isValidDuration = typeof duration === "number" && duration > 0;
      if (isValidDuration) {
        const outputDuration = getDurationParts(duration);
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Video duration:
- totalSeconds: ${outputDuration.totalSeconds}
- hours: ${outputDuration.hours}
- minutes: ${outputDuration.minutes}
- seconds: ${outputDuration.seconds}
Embed this URL and duration in the task content that you create. Follow user requirements STRICTLY about the link formatting rule.`;
      } else {
        systemPrompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Embed this URL in the task content that you create. Follow user requirements STRICTLY about the link formatting rule.`;
      }
    }

    if (videoFilePath) {
      systemPrompt += `\n\nVideo file available for screenshot capture: ${videoFilePath}.`;
    }

    return systemPrompt;
  }

  /**
   * Builds the SINGLE-entry `--mcp-config` (#915): one `yakshaver` MCP server that proxies the
   * app's full aggregated toolset over the localhost bridge. No per-server serialization and no
   * OAuth-token injection here — the front-door reaches the app, which applies its own auth.
   *
   * The resulting tools appear to Claude as `mcp__yakshaver__<Server__tool>`.
   */
  public buildMcpConfig(frontDoor: YakshaverFrontDoorConfig): ClaudeMcpConfigFile {
    const entry: ClaudeStdioServer = {
      type: "stdio",
      command: frontDoor.command,
      args: [frontDoor.cliEntryPath, "mcp-serve"],
    };
    if (frontDoor.env && Object.keys(frontDoor.env).length > 0) {
      entry.env = frontDoor.env;
    }
    return { mcpServers: { [YAKSHAVER_MCP_SERVER_KEY]: entry } };
  }

  /**
   * Builds the `--allowedTools` list for ask/wait modes: the app's whitelisted, server-prefixed
   * tool names (`Server__tool`), each re-prefixed for the single front-door so Claude sees them as
   * `mcp__yakshaver__<Server__tool>`. (Built-in/internal tools are always whitelisted by the
   * manager, so they flow through here too.) Under yolo this is unused.
   */
  public async buildAllowedTools(manager: OrchestratorServerManager): Promise<string[]> {
    // Warm the MCP clients first (best-effort) so built-in/internal tools — which are only
    // reflected in the whitelist once their client is connected — are included.
    if (manager.collectToolsWithServerPrefixAsync) {
      await manager.collectToolsWithServerPrefixAsync().catch(() => {
        /* no enabled servers / nothing to warm — the stored whitelist still applies */
      });
    }
    const prefixedWhitelist = await manager.getWhitelistWithServerPrefixAsync();
    return prefixedWhitelist.map((name) => `mcp__${YAKSHAVER_MCP_SERVER_KEY}__${name}`);
  }

  /**
   * Maps the approval mode to Claude Code's permission flags:
   * - `yolo` → `--permission-mode bypassPermissions` (run every tool immediately).
   * - `ask` / `wait` → `--allowedTools <whitelist>` (only the whitelisted tools may run; anything
   *   else is denied by Claude rather than hanging on an interactive prompt the headless run can't answer).
   *
   * Always passes `--strict-mcp-config` so Claude loads ONLY our single front-door config and
   * ignores any ambient user/project `.mcp.json`.
   */
  public buildArgv(
    mcpConfigPath: string,
    approvalMode: ToolApprovalMode,
    allowedTools: string[],
  ): string[] {
    const argv = [
      "-p",
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    if (approvalMode === "yolo") {
      argv.push("--permission-mode", "bypassPermissions");
    } else {
      // ask & wait: a headless process can't service interactive approvals, so we constrain the
      // run to the user-approved (whitelisted) tools. An empty whitelist yields no extra tools.
      if (allowedTools.length > 0) {
        argv.push("--allowedTools", allowedTools.join(","));
      }
    }

    return argv;
  }

  private async runClaude(
    argv: string[],
    systemPrompt: string,
    videoTranscription: string,
    options: ManualLoopOptions,
  ): Promise<MCPLoopResult> {
    const toolActivity: ToolActivity[] = [];

    const child = this.spawner.spawn(this.claudeCommand, argv);

    // Always emit a first line so the Executing Task box is never empty, even before Claude
    // streams anything (and even when its narration ends up terse).
    options.onStep?.({
      type: "start",
      message: "Orchestrating with Claude Code (local)…",
    });

    // The full prompt = system prompt + the transcript as the user input, passed over stdin so
    // long transcripts don't bump into argv length limits.
    const fullPrompt = `${systemPrompt}\n\n---\nvideo transcription: ${videoTranscription}`;
    child.stdin?.write(fullPrompt);
    child.stdin?.end();

    const { finalText, terminationReason } = await new Promise<{
      finalText: string;
      terminationReason: MCPTerminationReason;
    }>((resolve, reject) => {
      let stdoutBuffer = "";
      let stderr = "";
      let finalText = "";
      let terminationReason: MCPTerminationReason = "unknown";

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event: ClaudeStreamEvent;
        try {
          event = JSON.parse(trimmed) as ClaudeStreamEvent;
        } catch {
          // Non-JSON lines (e.g. stray logs) are ignored — the stream is newline-delimited JSON.
          return;
        }
        const result = this.handleStreamEvent(event, toolActivity, options.onStep);
        if (result.finalText !== undefined) finalText = result.finalText;
        if (result.terminationReason) terminationReason = result.terminationReason;
      };

      child.stdout?.on("data", (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        // Keep the last (possibly partial) line in the buffer.
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error: Error) => {
        reject(new Error(`Failed to start Claude Code: ${error.message}`));
      });

      child.on("close", (code: number | null) => {
        // Flush any trailing buffered line.
        if (stdoutBuffer.trim()) handleLine(stdoutBuffer);

        if (code !== 0 && terminationReason === "unknown") {
          reject(
            new Error(
              `Claude Code process exited with code ${code ?? "unknown"}.${stderr ? ` Error: ${stderr}` : ""}`,
            ),
          );
          return;
        }
        resolve({ finalText, terminationReason });
      });
    });

    options.onStep?.({ type: "final_result", message: terminationReason });

    const provider = this.judgeProvider ?? (await this.getJudgeProvider());
    const outcome = await judgeBacklogOutcome(
      provider,
      options.desktopAgentProjectPrompt,
      videoTranscription,
      toolActivity,
      finalText,
    );

    return {
      text: finalText,
      backlogActionSucceeded: outcome.achieved,
      artifacts: outcome.artifacts,
      terminationReason,
    };
  }

  /**
   * Translates one Claude Code stream-json event into the UI's `MCPStep` progress events (the
   * same shape the OpenAI loop emits) and records tool calls/results for the outcome judge.
   */
  private handleStreamEvent(
    event: ClaudeStreamEvent,
    toolActivity: ToolActivity[],
    onStep?: ManualLoopOptions["onStep"],
  ): { finalText?: string; terminationReason?: MCPTerminationReason } {
    // Assistant turn: may carry text and/or tool_use blocks.
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          // The UI's <ReasoningStep> JSON.parses `reasoning` and renders `parsed.text` — matching
          // how the OpenAI loop emits it. Wrap Claude's raw text the same way; emitting a bare
          // string would fail that parse and render a BLANK reasoning box (the root cause of the
          // sparse Executing Task box under the local-claude backend).
          onStep?.({
            type: "reasoning",
            reasoning: JSON.stringify({ type: "text", text: block.text }),
          });
        } else if (block.type === "tool_use") {
          onStep?.({
            type: "tool_call",
            toolName: stripFrontDoorPrefix(block.name ?? "unknown"),
            args: block.input,
          });
        }
      }
      return {};
    }

    // User turn carries tool_result blocks (Claude reports tool outputs as a user message).
    if (event.type === "user" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_result") {
          const resultText = extractToolResultText(block.content);
          const ok = block.is_error !== true;
          toolActivity.push({
            toolName: block.tool_use_id ?? "unknown",
            ok,
            resultText: resultText.slice(0, 8000),
          });
          onStep?.({ type: "tool_result", result: block.content });
        }
      }
      return {};
    }

    // Terminal result event: carries the final text + how the run ended.
    if (event.type === "result") {
      const finalText = event.result ?? "";
      const terminationReason: MCPTerminationReason =
        event.subtype === "success"
          ? "stop"
          : event.subtype === "error_max_turns"
            ? "max-iterations"
            : "unknown";
      return { finalText, terminationReason };
    }

    return {};
  }

  private async getJudgeProvider(): Promise<OutcomeJudgeProvider | null> {
    try {
      return await LanguageModelProvider.getInstance();
    } catch (error) {
      console.warn("[LocalClaudeOrchestrator] judge provider unavailable", error);
      return null;
    }
  }
}

/**
 * Resolve how to spawn the `yakshaver mcp-serve` front-door from the live Electron app + bridge.
 *
 * - command: the current binary run as plain Node (`ELECTRON_RUN_AS_NODE=1` + `process.execPath`),
 *   so we don't depend on a separately-installed node.
 * - cliEntryPath: the packaged CLI entry, `<appPath>/dist/cli/index.js`.
 * - env: bridge port + token (so the front-door connects without racing the token file) plus
 *   `ELECTRON_RUN_AS_NODE`.
 *
 * Lazily imports electron + the bridge server so the pure argv/config unit tests (which always
 * inject a `frontDoor`) never touch these singletons.
 */
async function resolveFrontDoorConfig(): Promise<YakshaverFrontDoorConfig> {
  const { app } = await import("electron");
  const { CliBridgeServer } = await import("../cli-bridge/cli-bridge-server");

  const cliEntryPath = join(app.getAppPath(), "dist", "cli", "index.js");
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };

  // Hand the front-door the live bridge port+token so it connects deterministically.
  const bridge = CliBridgeServer.getInstance();
  const port = bridge.getPort();
  const token = bridge.getToken();
  if (port != null) env.YAKSHAVER_BRIDGE_PORT = String(port);
  if (token) env.YAKSHAVER_BRIDGE_TOKEN = token;

  return { command: process.execPath, cliEntryPath, env };
}

/** A loose view of the Claude Code stream-json events we care about. */
interface ClaudeStreamEvent {
  type: "assistant" | "user" | "result" | "system" | string;
  subtype?: string;
  result?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }>;
  };
}

/** The prefix Claude prepends to every front-door tool: `mcp__yakshaver__<Server__tool>`. */
const FRONT_DOOR_TOOL_PREFIX = `mcp__${YAKSHAVER_MCP_SERVER_KEY}__`;

/**
 * Strips the single-front-door prefix from a tool name so the UI shows the real `Server__tool`
 * (e.g. `mcp__yakshaver__GitHub__issue_write` -> `GitHub__issue_write`). The UI's `formatToolName`
 * splits on the FIRST `__`, so without this it would mis-parse the server as `mcp` and render a
 * messy/blank tool label. Non-front-door tools (Claude built-ins) are returned unchanged.
 */
export function stripFrontDoorPrefix(toolName: string): string {
  return toolName.startsWith(FRONT_DOOR_TOOL_PREFIX)
    ? toolName.slice(FRONT_DOOR_TOOL_PREFIX.length)
    : toolName;
}

/** Tool results in stream-json may be a string or an array of `{type:"text", text}` blocks. */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as { text?: unknown }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}
