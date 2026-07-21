import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLI_BRIDGE_PORT_ENV,
  CLI_BRIDGE_SERVER_FILTER_ENV,
  CLI_BRIDGE_SHAVE_ID_ENV,
  CLI_BRIDGE_TOKEN_ENV,
} from "../../../shared/cli-bridge/protocol";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";
import { getDurationParts } from "../../utils/duration-utils";
import type { VideoUploadResult } from "../auth/types";
import type { IProcessSpawner } from "../process/process-spawner";
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

/** Default safety cap on tool iterations when the caller doesn't supply one (mirrors the OpenAI loop). */
const DEFAULT_MAX_TOOL_ITERATIONS = 20;

/**
 * Wall-clock cap on a single headless `claude -p` run. `--max-turns` bounds the number of agent
 * TURNS, but a tool stalled on I/O (a hung MCP server, a network stall) never advances a turn, so
 * that cap never trips and the awaited Promise would hang EXECUTING_TASK forever. This timeout
 * kills the child and rejects with a clear message so a stuck run surfaces instead of hanging.
 * Overridable via `LOCAL_CLAUDE_RUN_TIMEOUT_MS` for slow environments / long-running tools.
 */
const DEFAULT_RUN_TIMEOUT_MS = Number(process.env.LOCAL_CLAUDE_RUN_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * Default spawner for the `claude` CLI. On Windows, an npm-global install of `@anthropic-ai/claude-code`
 * places a `claude.cmd`/`claude.ps1` shim on PATH (no `.exe`), and Node's `child_process.spawn` cannot
 * launch a `.cmd`/`.ps1` shim without `shell: true` — it throws ENOENT, which would make a user who
 * genuinely has Claude Code installed see a false "not found". So spawn through the shell on win32.
 * (ffmpeg-service can use the plain spawner because it launches an absolute bundled binary, never a
 * bare PATH name.)
 */
const defaultClaudeSpawner: IProcessSpawner = {
  spawn: (command, args) => spawn(command, args, { shell: process.platform === "win32" }),
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

/** The prefix Claude Code prepends to every front-door tool, e.g. `mcp__yakshaver__GitHub__issue`. */
const FRONT_DOOR_TOOL_PREFIX = `mcp__${YAKSHAVER_MCP_SERVER_KEY}__`;

/**
 * Strip the `mcp__yakshaver__` front-door prefix so the real server-prefixed name (`Server__tool`)
 * is what the judge, tool activity, and UI see — Claude reports tools by their front-door name, but
 * everything downstream expects the same `Server__tool` names the OpenAI loop uses. Non-front-door
 * names (Claude built-ins like `Read`) are returned unchanged.
 */
export function stripFrontDoorPrefix(toolName: string): string {
  return toolName.startsWith(FRONT_DOOR_TOOL_PREFIX)
    ? toolName.slice(FRONT_DOOR_TOOL_PREFIX.length)
    : toolName;
}

/**
 * How to spawn the single `yakshaver mcp-serve` front-door (#915), and how the spawned process
 * reaches the running app's bridge.
 *
 * Injectable so the argv/config unit tests stay pure (no Electron `app`, no `process.execPath`, no
 * live bridge). The real value is resolved from the Electron app + the running `CliBridgeServer` at
 * call time.
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
  // (and the argv/config unit tests that do) never touches the electron-backed singletons.
  constructor(
    private readonly claudeCommand: string = "claude",
    private readonly spawner: IProcessSpawner = defaultClaudeSpawner,
    private readonly serverManager: OrchestratorServerManager | null = null,
    private readonly frontDoor: YakshaverFrontDoorConfig | null = null,
    private readonly settingsStorage: Pick<UserSettingsStorage, "getSettingsAsync"> | null = null,
    private readonly judgeProvider: OutcomeJudgeProvider | null = null,
    private readonly runTimeoutMs: number = DEFAULT_RUN_TIMEOUT_MS,
  ) {}

  private getSettingsStorage(): Pick<UserSettingsStorage, "getSettingsAsync"> {
    return this.settingsStorage ?? UserSettingsStorage.getInstance();
  }

  /** Verifies the `claude` CLI is reachable; throws a user-actionable error if not. */
  public async ensureClaudeAvailable(): Promise<void> {
    const { ok, spawnError } = await new Promise<{ ok: boolean; spawnError?: Error }>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawner.spawn(this.claudeCommand, ["--version"]);
      } catch (error) {
        resolve({
          ok: false,
          spawnError: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      }
      // An `error` event (e.g. ENOENT) means we could not launch the binary at all.
      child.on("error", (error: Error) => resolve({ ok: false, spawnError: error }));
      // A non-zero exit means the binary launched but reported a problem (not a PATH miss).
      child.on("close", (code) => resolve({ ok: code === 0, spawnError: undefined }));
    });

    if (ok) return;

    // Distinguish "couldn't launch the process at all" (PATH miss / unlaunchable shim) from
    // "launched but exited non-zero" so the message points at the real cause.
    if (spawnError) {
      throw new Error(
        `Claude Code CLI could not be launched (${spawnError.message}). Make sure the \`claude\` ` +
          "CLI is installed and on PATH, or switch Orchestrator to OpenAI in Settings.",
      );
    }
    throw new Error(
      "Claude Code CLI was found but `claude --version` exited with an error. Reinstall the " +
        "CLI, or switch Orchestrator to OpenAI in Settings.",
    );
  }

  public async manualLoopAsync(
    videoTranscription: string,
    videoUploadResult?: VideoUploadResult,
    options: ManualLoopOptions = {},
  ): Promise<MCPLoopResult> {
    await this.ensureClaudeAvailable();

    const manager = this.serverManager ?? (await MCPServerManager.getInstanceAsync());
    const frontDoor =
      this.frontDoor ?? (await resolveFrontDoorConfig(options.serverFilter, options.shaveId));
    const approvalMode = (await this.getSettingsStorage().getSettingsAsync()).toolApprovalMode;

    const systemPrompt = this.buildSystemPrompt(
      options.projectMetaData,
      options.desktopAgentProjectPrompt,
      videoUploadResult,
      options.videoFilePath,
    );

    // #915: one front-door entry proxies the app's aggregated toolset (incl. internal/in-memory
    // servers). `options.serverFilter` (the project's selected servers) is passed to the front-door
    // via env so the app restricts both the LISTED and the CALLABLE tools to that project — that
    // server-side filter is the authoritative gate. `--allowedTools` below is only the ask-mode
    // auto-approve list; it need not be filtered because an unselected tool isn't reachable anyway.
    const mcpConfig = this.buildMcpConfig(frontDoor);
    const allowedTools = await this.buildAllowedTools(manager);

    this.surfaceServerNotices(approvalMode, allowedTools, options.onStep);

    const tmpConfigPath = join(tmpdir(), `yakshaver-mcp-${randomUUID()}.json`);
    const tmpPromptPath = join(tmpdir(), `yakshaver-sysprompt-${randomUUID()}.txt`);
    // The MCP config carries the live OAuth bearer token, so write it owner-read/write only
    // (0600). Without this, Node defaults to 0644 and `tmpdir()` is a world-readable shared dir
    // on POSIX, so any local user could read the token for the lifetime of the run.
    await fs.writeFile(tmpConfigPath, JSON.stringify(mcpConfig, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.writeFile(tmpPromptPath, systemPrompt, { encoding: "utf8", mode: 0o600 });

    try {
      const argv = this.buildArgv(
        tmpConfigPath,
        tmpPromptPath,
        approvalMode,
        allowedTools,
        options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
      );
      return await this.runClaude(argv, videoTranscription, options);
    } finally {
      await Promise.all([
        fs.unlink(tmpConfigPath).catch(() => {
          /* best-effort cleanup */
        }),
        fs.unlink(tmpPromptPath).catch(() => {
          /* best-effort cleanup */
        }),
      ]);
    }
  }

  /**
   * Surfaces approval-mode caveats to both the log and the UI (via an onStep notice) so the user
   * understands why tools may be unavailable under the local backend — rather than seeing a silent
   * run that quietly does less than the OpenAI path would.
   *
   * As of #915 the front-door proxies ALL servers (incl. internal/in-memory ones), so there is no
   * per-server skip or in-memory-drop notice anymore — only the approval-mode caveats remain.
   */
  private surfaceServerNotices(
    approvalMode: ToolApprovalMode,
    allowedTools: string[],
    onStep?: ManualLoopOptions["onStep"],
  ): void {
    const notices: string[] = [];

    // Under "ask" only whitelisted tools auto-approve and nothing prompts; an empty whitelist means
    // no MCP tools can run at all, so warn rather than letting the run silently do nothing.
    if (approvalMode === "ask" && allowedTools.length === 0) {
      const msg =
        'Claude Code (local) only runs whitelisted tools under "ask" approval mode (no runtime ' +
        "approval prompt), and no tools are currently whitelisted — so no MCP tools will run. " +
        'Whitelist tools in YakShaver, or switch the approval mode to "yolo".';
      notices.push(msg);
      console.warn(`[LocalClaudeOrchestrator] ${msg}`);
    }

    // "wait" needs no caveat here (#920): a non-whitelisted MCP tool call is gated by
    // `McpToolBridge.callTool` in the main process, which raises the same approval dialog+countdown
    // the OpenAI backend shows and blocks the run until the user responds or the countdown
    // auto-approves — the same behaviour as the OpenAI path, not a silent widening to YOLO.

    for (const text of notices) {
      onStep?.({ type: "reasoning", reasoning: JSON.stringify({ type: "text", text }) });
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
   * Maps the approval mode to Claude Code's permission flags.
   *
   * These flags only control Claude's OWN built-in tools (Read/Write/Bash/etc.) at the CLI layer.
   * MCP tools (everything YakShaver actually cares about — GitHub/Jira/Azure DevOps/etc.) do NOT
   * stop at this layer: every `tools/call` for the single `yakshaver` front-door is proxied to
   * {@link McpToolBridge.callTool} in the main process, which enforces the REAL approval policy
   * server-side regardless of `--permission-mode` (#920) — including, under `wait`, raising the
   * same approval dialog+countdown the OpenAI backend shows.
   *
   * - `yolo` → `--permission-mode bypassPermissions` (run every built-in tool immediately; MCP
   *   tools run immediately too, per the bridge's own `yolo` handling).
   * - `wait` → ALSO `--permission-mode bypassPermissions`, so Claude's own built-in tools aren't
   *   hard-denied at the CLI layer (there is no bridge in front of those to defer to). MCP tools are
   *   NOT auto-approved here — the bridge gates them on the whitelist and prompts via the approval
   *   dialog for anything not already whitelisted, so `wait` behaves the same as the OpenAI backend
   *   for the tools that matter.
   * - `ask` → `--allowedTools <whitelist>` + `--permission-mode dontAsk`. `--allowedTools` only
   *   auto-approves the listed tools; on its own (default permission mode) a non-whitelisted tool
   *   would trigger an interactive prompt the headless run can't answer and the run can hang/abort.
   *   `dontAsk` converts any such prompt into an outright denial, so the run never blocks. (MCP
   *   tools are additionally gated by the bridge itself, same as always.)
   *
   * `--strict-mcp-config` ensures Claude only uses the servers we serialized into `--mcp-config`,
   * ignoring any ambient project `.mcp.json` / `~/.claude` MCP config so the embedded run is
   * deterministic across machines and can't reach servers YakShaver never configured.
   */
  public buildArgv(
    mcpConfigPath: string,
    systemPromptPath: string,
    approvalMode: ToolApprovalMode,
    allowedTools: string[],
    maxToolIterations: number = DEFAULT_MAX_TOOL_ITERATIONS,
  ): string[] {
    const argv = [
      "-p",
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--system-prompt-file",
      systemPromptPath,
      "--output-format",
      "stream-json",
      "--verbose",
      // Mirror the OpenAI loop's iteration safety cap (`maxToolIterations`) so a runaway local
      // run is bounded by the SAME limit; `handleStreamEvent` maps Claude's `error_max_turns` to
      // our `max-iterations` termination reason.
      "--max-turns",
      String(maxToolIterations),
    ];

    if (approvalMode === "yolo" || approvalMode === "wait") {
      argv.push("--permission-mode", "bypassPermissions");
    } else {
      // ask: only the user-approved (whitelisted) tools auto-approve; `dontAsk` denies anything
      // else instead of prompting (which a headless run can't answer). An empty whitelist means
      // no MCP tools run.
      argv.push("--permission-mode", "dontAsk");
      if (allowedTools.length > 0) {
        argv.push("--allowedTools", allowedTools.join(","));
      }
    }

    return argv;
  }

  private async runClaude(
    argv: string[],
    videoTranscription: string,
    options: ManualLoopOptions,
  ): Promise<MCPLoopResult> {
    const toolActivity: ToolActivity[] = [];
    // Correlates a tool_use block's opaque id (e.g. `toolu_01ABC...`) back to its real tool name,
    // so the tool_result we record later carries the actual name instead of the opaque id.
    const toolNameById = new Map<string, string>();

    // Reject early if the caller already aborted before we spawned anything.
    if (options.signal?.aborted) {
      throw new Error("Claude Code run was cancelled.");
    }

    const child = this.spawner.spawn(this.claudeCommand, argv);

    // Always emit a first line so the Executing Task box is never empty, even before Claude
    // streams anything (and even when its narration ends up terse).
    options.onStep?.({
      type: "start",
      message: "Orchestrating with Claude Code…",
    });

    // The orchestrator role is delivered via `--system-prompt` (in argv), so only the transcript
    // goes on stdin as the user turn. Passing it over stdin avoids argv length limits.
    const userPrompt = `video transcription: ${videoTranscription}`;
    // If `claude` dies before/while we write, its stdin pipe closes and the write emits EPIPE on the
    // stdin stream. An unhandled `error` on a stream throws (and would crash the host process), so
    // swallow it here — the real failure is reported by the child's `error`/non-zero `close` paths.
    // (Optional `?.on` guards the unit-test mock whose stdin is a plain `{write,end}` object.)
    child.stdin?.on?.("error", () => {
      /* EPIPE on a dead child — handled via child error/close below */
    });
    child.stdin?.write(userPrompt);
    child.stdin?.end();

    const { finalText, terminationReason } = await new Promise<{
      finalText: string;
      terminationReason: MCPTerminationReason;
    }>((resolve, reject) => {
      let stdoutBuffer = "";
      let stderr = "";
      let finalText = "";
      let terminationReason: MCPTerminationReason = "unknown";
      let settled = false;

      // Kill the spawned child on any terminal path (timeout, abort, error, non-zero exit) so a
      // stalled `claude -p` never lingers as an orphan after we stop awaiting it.
      const killChild = () => {
        try {
          child.kill();
        } catch {
          /* the child may already be gone — best effort */
        }
      };

      // A wall-clock guard: `--max-turns` bounds turns, not time, so a tool hung on I/O would hang
      // forever. On timeout, kill the child and reject with an actionable message.
      const timeoutMs = this.runTimeoutMs;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        killChild();
        reject(
          new Error(
            `Claude Code run timed out after ${Math.round(timeoutMs / 1000)}s with no result. ` +
              "The Claude CLI or an MCP tool may be stalled — try again, or switch Orchestrator " +
              "to OpenAI in Settings.",
          ),
        );
      }, timeoutMs);

      // Cancellation: when the caller's signal fires, kill the child and reject so an in-flight
      // local run can be aborted the way the OpenAI backend can.
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        killChild();
        reject(new Error("Claude Code run was cancelled."));
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", onAbort);
      };
      options.signal?.addEventListener("abort", onAbort);

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
        const result = this.handleStreamEvent(event, toolActivity, toolNameById, options.onStep);
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
        if (settled) return;
        settled = true;
        cleanup();
        killChild();
        reject(new Error(`Failed to start Claude Code: ${error.message}`));
      });

      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Flush any trailing buffered line.
        if (stdoutBuffer.trim()) handleLine(stdoutBuffer);

        if (code !== 0 && terminationReason === "unknown") {
          // A non-zero exit with no result event is most commonly an auth failure (the headless
          // `claude -p` can't prompt for login, so it exits with an auth error on stderr). Append
          // actionable guidance so the user isn't left with a bare exit code.
          const guidance =
            " Claude Code may not be signed in — run `claude` in a terminal to log in, or switch the Orchestrator to OpenAI in Settings.";
          reject(
            new Error(
              `Claude Code process exited with code ${code ?? "unknown"}.${stderr ? ` Error: ${stderr}` : ""}${guidance}`,
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

    // The success judge (#833) runs on the configured OpenAI/Azure language model — it is NOT
    // driven by Claude. If a user selected Claude Code to avoid configuring a language model, the
    // judge is unavailable: judgeBacklogOutcome fails CLOSED but flags verificationUnavailable so
    // a run where Claude genuinely filed an item isn't reported with the misleading generic
    // "backlog signed out" copy. Surface the real cause in the step stream too.
    if (outcome.verificationUnavailable) {
      const text =
        "Claude Code created or updated something, but success could NOT be verified because no " +
        "OpenAI/Azure language model is configured — Claude Code orchestration still needs a " +
        "configured language model to verify the outcome. Check your backlog before re-running " +
        "(to avoid duplicates), and configure a language model in Settings to confirm success.";
      options.onStep?.({ type: "reasoning", reasoning: JSON.stringify({ type: "text", text }) });
      console.warn(`[LocalClaudeOrchestrator] ${text}`);
    }

    return {
      text: finalText,
      backlogActionSucceeded: outcome.achieved,
      artifacts: outcome.artifacts,
      terminationReason,
      verificationUnavailable: outcome.verificationUnavailable,
    };
  }

  /**
   * Translates one Claude Code stream-json event into the UI's `MCPStep` progress events (the
   * same shape the OpenAI loop emits) and records tool calls/results for the outcome judge.
   */
  private handleStreamEvent(
    event: ClaudeStreamEvent,
    toolActivity: ToolActivity[],
    toolNameById: Map<string, string>,
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
          // Claude reports the front-door tool name (`mcp__yakshaver__Server__tool`); strip the
          // prefix once here so both the id->name map (used by the judge) and the UI step carry the
          // real `Server__tool` name.
          const toolName = stripFrontDoorPrefix(block.name ?? "unknown");
          // Remember which tool this opaque id belongs to so the matching tool_result (which only
          // carries the id) can be recorded under the real tool name.
          if (block.id) toolNameById.set(block.id, toolName);
          onStep?.({
            type: "tool_call",
            toolName,
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
          // `tool_use_id` is the opaque correlation id of the originating tool_use block, NOT the
          // tool name. Resolve it back to the real name so the judge and logs see meaningful names.
          const toolName =
            (block.tool_use_id ? toolNameById.get(block.tool_use_id) : undefined) ??
            block.tool_use_id ??
            "unknown";
          toolActivity.push({
            toolName,
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
async function resolveFrontDoorConfig(
  serverFilter?: string[],
  shaveId?: string,
): Promise<YakshaverFrontDoorConfig> {
  const { app } = await import("electron");
  const { CliBridgeServer } = await import("../cli-bridge/cli-bridge-server");

  const cliEntryPath = join(app.getAppPath(), "dist", "cli", "index.js");
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };

  // Hand the front-door the live bridge port+token so it connects deterministically.
  const bridge = CliBridgeServer.getInstance();
  const port = bridge.getPort();
  const token = bridge.getToken();
  if (port != null) env[CLI_BRIDGE_PORT_ENV] = String(port);
  if (token) env[CLI_BRIDGE_TOKEN_ENV] = token;
  // Restrict the front-door to the project's selected servers (empty = all enabled servers).
  if (serverFilter && serverFilter.length > 0) {
    env[CLI_BRIDGE_SERVER_FILTER_ENV] = serverFilter.join(",");
  }
  // Forward the shave id so a `wait`-mode approval prompt raised via the bridge (#920) can honour
  // the same per-shave auto-approve override the OpenAI backend supports.
  if (shaveId) {
    env[CLI_BRIDGE_SHAVE_ID_ENV] = shaveId;
  }

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
      id?: string;
      text?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }>;
  };
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
