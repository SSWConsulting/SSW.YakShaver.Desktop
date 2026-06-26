import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";
import { getDurationParts } from "../../utils/duration-utils";
import type { VideoUploadResult } from "../auth/types";
import type { IProcessSpawner } from "../process/process-spawner";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";
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
import { getFreshAccessTokenAsync, type RefreshableTokenStorage } from "./mcp-token-refresh";
import { orchestratorSystemPrompt } from "./prompts";
import type { MCPServerConfig } from "./types";

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

/**
 * Token lookup the orchestrator needs. A bare `getTokensAsync` is enough for tests; the real
 * `McpOAuthTokenStorage` also provides the optional refresh hooks (`isTokenExpired` /
 * `saveTokensAsync` / `clearTokensAsync`) so expired tokens are refreshed before use — see
 * `getFreshAccessTokenAsync`.
 */
export type TokenLookup = RefreshableTokenStorage;

/** Claude Code's tool name format is `mcp__<server>__<tool>`. Server names are sanitized to match. */
function sanitizeServerName(name: string): string {
  return name.replace(/\s+/g, "_");
}

/**
 * Drives the backlog-creation step with a local headless `claude -p` process instead of the
 * in-process OpenAI loop. Serializes the enabled MCP servers to a temp `--mcp-config`, maps the
 * tool-approval mode to Claude's permission flags, streams `stream-json` events to `onStep`, and
 * reuses the shared `judgeBacklogOutcome` on the collected tool results.
 */
export class LocalClaudeOrchestrator implements IBacklogOrchestrator {
  // Storage deps are resolved lazily — only when actually needed — so constructing the orchestrator
  // (and the argv/serialization unit tests that do) never touches the electron-backed singletons.
  constructor(
    private readonly claudeCommand: string = "claude",
    private readonly spawner: IProcessSpawner = defaultClaudeSpawner,
    private readonly serverManager: Pick<MCPServerManager, "listAvailableServers"> | null = null,
    private readonly tokenStorage: TokenLookup | null = null,
    private readonly settingsStorage: Pick<UserSettingsStorage, "getSettingsAsync"> | null = null,
    private readonly judgeProvider: OutcomeJudgeProvider | null = null,
    private readonly runTimeoutMs: number = DEFAULT_RUN_TIMEOUT_MS,
  ) {}

  private getTokenStorage(): TokenLookup {
    return this.tokenStorage ?? McpOAuthTokenStorage.getInstance();
  }

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
    const approvalMode = (await this.getSettingsStorage().getSettingsAsync()).toolApprovalMode;

    const systemPrompt = this.buildSystemPrompt(
      options.projectMetaData,
      options.desktopAgentProjectPrompt,
      videoUploadResult,
      options.videoFilePath,
    );

    const { mcpConfig, allowedTools, skippedNonWhitelistedServers, droppedInMemoryServers } =
      await this.serializeMcpServers(manager, options.serverFilter);

    this.surfaceServerNotices(
      approvalMode,
      skippedNonWhitelistedServers,
      droppedInMemoryServers,
      options.onStep,
    );

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
   * Surfaces server-selection caveats to both the log and the UI (via an onStep notice) so the
   * user understands why a tool/server may be unavailable under the local backend — rather than
   * seeing a silent run that quietly does less than the OpenAI path would.
   */
  private surfaceServerNotices(
    approvalMode: ToolApprovalMode,
    skippedNonWhitelistedServers: string[],
    droppedInMemoryServers: string[],
    onStep?: ManualLoopOptions["onStep"],
  ): void {
    const notices: string[] = [];

    if (skippedNonWhitelistedServers.length > 0 && approvalMode === "ask") {
      const msg = `Claude Code (local) only runs whitelisted tools under "ask" approval mode (no runtime approval prompt). These server(s) have no whitelisted tools, so their tools were not made available: ${skippedNonWhitelistedServers.join(", ")}.`;
      notices.push(msg);
      console.warn(`[LocalClaudeOrchestrator] ${msg}`);
    }

    // Under "wait", the OpenAI path shows a 15s approval dialog the user can still deny within. A
    // headless `claude -p` can't render that deferred prompt, so "wait" runs EVERY tool immediately
    // (effectively YOLO) under the local backend. Tell the user so the safe-looking "wait" setting
    // doesn't silently widen tool execution without any signal.
    if (approvalMode === "wait") {
      const msg =
        'Claude Code (local) cannot show the "wait" approval dialog because it runs headlessly, ' +
        "so under this backend every tool runs immediately without a chance to deny (the same as " +
        '"YOLO"). Switch to "ask" to restrict the run to whitelisted tools only.';
      notices.push(msg);
      console.warn(`[LocalClaudeOrchestrator] ${msg}`);
    }

    if (droppedInMemoryServers.length > 0) {
      const msg = `Claude Code (local) cannot reach YakShaver's built-in in-memory tools, so these are unavailable under this backend (e.g. screenshot capture): ${droppedInMemoryServers.join(", ")}.`;
      notices.push(msg);
      console.warn(`[LocalClaudeOrchestrator] ${msg}`);
    }

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
   * Serializes the enabled MCP servers (respecting `serverFilter`) into Claude Code's
   * `--mcp-config` format. stdio → {command,args,env}; streamableHttp → {url, headers} with the
   * OAuth bearer token injected from token storage when present. Also returns the `--allowedTools`
   * derived from each server's whitelist (used under ask/wait approval modes).
   */
  public async serializeMcpServers(
    manager: Pick<MCPServerManager, "listAvailableServers">,
    serverFilter?: string[],
  ): Promise<{
    mcpConfig: ClaudeMcpConfigFile;
    allowedTools: string[];
    skippedNonWhitelistedServers: string[];
    droppedInMemoryServers: string[];
  }> {
    const all = await manager.listAvailableServers();
    const filterSet = serverFilter && serverFilter.length > 0 ? new Set(serverFilter) : null;

    const selected = all.filter((c) => {
      if (c.enabled === false) return false;
      if (!filterSet) return true;
      return filterSet.has(c.id) || filterSet.has(c.name);
    });

    const mcpServers: Record<string, ClaudeMcpServer> = {};
    const allowedTools: string[] = [];
    const skippedNonWhitelistedServers: string[] = [];
    const droppedInMemoryServers: string[] = [];

    for (const config of selected) {
      // inMemory servers are YakShaver-internal (e.g. Yak_Video_Tools' screenshot capture); Claude
      // Code can't reach them over its own transports, so they're dropped for the local backend.
      // Surface them so the caller can warn the user that the local backend lacks those tools.
      if (config.transport === "inMemory") {
        droppedInMemoryServers.push(config.name);
        continue;
      }

      const serverKey = sanitizeServerName(config.name);
      const entry = await this.toClaudeServerEntry(config);
      if (!entry) continue;
      mcpServers[serverKey] = entry;

      const whitelist = config.toolWhitelist ?? [];
      if (whitelist.length === 0) {
        skippedNonWhitelistedServers.push(config.name);
      }
      for (const toolName of whitelist) {
        allowedTools.push(`mcp__${serverKey}__${toolName}`);
      }
    }

    return {
      mcpConfig: { mcpServers },
      allowedTools,
      skippedNonWhitelistedServers,
      droppedInMemoryServers,
    };
  }

  private async toClaudeServerEntry(config: MCPServerConfig): Promise<ClaudeMcpServer | null> {
    if (config.transport === "stdio") {
      const entry: ClaudeStdioServer = {
        type: "stdio",
        command: config.command,
      };
      if (config.args && config.args.length > 0) entry.args = config.args;
      if (config.env && Object.keys(config.env).length > 0) entry.env = config.env;
      return entry;
    }

    if (config.transport === "streamableHttp") {
      const headers: Record<string, string> = { ...config.headers };
      // Inject the OAuth bearer token so Claude Code authenticates the same way the in-process
      // client does (built-in servers don't use OAuth). Refresh an expired token first — the same
      // freshness guarantee MCPServerClient applies — so the local backend doesn't hand Claude a
      // stale token that an HTTP MCP server would 401.
      if (!config.builtin) {
        const accessToken = await getFreshAccessTokenAsync(
          this.getTokenStorage(),
          config.id,
          config.url,
        );
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }
      }
      const entry: ClaudeHttpServer = { type: "http", url: config.url };
      if (Object.keys(headers).length > 0) entry.headers = headers;
      return entry;
    }

    return null;
  }

  /**
   * Maps the approval mode to Claude Code's permission flags.
   *
   * - `yolo` → `--permission-mode bypassPermissions` (run every tool immediately).
   * - `wait` → ALSO `--permission-mode bypassPermissions`. In the OpenAI backend `wait` shows the
   *   approval prompt but AUTO-APPROVES after a delay, so a non-whitelisted tool the user doesn't
   *   dismiss still RUNS. A headless `claude -p` can't render a deferred prompt, so the faithful
   *   analogue of "auto-approve after a delay" is to bypass permissions — otherwise `wait` would
   *   silently HARD-DENY non-whitelisted tools, diverging from the OpenAI behaviour for the same
   *   setting. (See requestToolApproval's `wait` -> auto-approve path.)
   * - `ask` → `--allowedTools <whitelist>` + `--permission-mode dontAsk`. `--allowedTools` only
   *   auto-approves the listed tools; on its own (default permission mode) a non-whitelisted tool
   *   would trigger an interactive prompt the headless run can't answer and the run can hang/abort.
   *   `dontAsk` converts any such prompt into an outright denial, so the run never blocks.
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
          // Match the OpenAI loop's payload shape so ReasoningStep's JSON.parse path renders it
          // (it reads `parsed.text`). Emitting raw text here would render blank in the UI.
          onStep?.({
            type: "reasoning",
            reasoning: JSON.stringify({ type: "text", text: block.text }),
          });
        } else if (block.type === "tool_use") {
          const toolName = block.name ?? "unknown";
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
