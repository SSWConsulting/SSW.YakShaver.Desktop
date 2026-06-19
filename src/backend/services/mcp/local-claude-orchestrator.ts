import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalMode } from "../../../shared/types/user-settings";
import { getDurationParts } from "../../utils/duration-utils";
import type { VideoUploadResult } from "../auth/types";
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
import { orchestratorSystemPrompt } from "./prompts";
import type { MCPServerConfig } from "./types";

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

/** Minimal token lookup the orchestrator needs — narrower than the full storage so tests stub it easily. */
export interface TokenLookup {
  getTokensAsync(serverId: string): Promise<{ access_token?: string } | undefined>;
}

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
    private readonly spawner: IClaudeProcessSpawner = defaultClaudeSpawner,
    private readonly serverManager: Pick<MCPServerManager, "listAvailableServers"> | null = null,
    private readonly tokenStorage: TokenLookup | null = null,
    private readonly settingsStorage: Pick<UserSettingsStorage, "getSettingsAsync"> | null = null,
    private readonly judgeProvider: OutcomeJudgeProvider | null = null,
  ) {}

  private getTokenStorage(): TokenLookup {
    return this.tokenStorage ?? McpOAuthTokenStorage.getInstance();
  }

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
    const approvalMode = (await this.getSettingsStorage().getSettingsAsync()).toolApprovalMode;

    const systemPrompt = this.buildSystemPrompt(
      options.projectMetaData,
      options.desktopAgentProjectPrompt,
      videoUploadResult,
      options.videoFilePath,
    );

    const { mcpConfig, allowedTools, skippedNonWhitelistedServers } =
      await this.serializeMcpServers(manager, options.serverFilter);

    if (skippedNonWhitelistedServers.length > 0) {
      console.warn(
        `[LocalClaudeOrchestrator] No whitelisted tools for server(s): ${skippedNonWhitelistedServers.join(", ")} under "${approvalMode}" approval mode — proceeding with whatever is whitelisted; non-whitelisted tools were skipped.`,
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

    for (const config of selected) {
      // inMemory servers are YakShaver-internal; Claude Code can't reach them over its own
      // transports, so they're skipped for the local backend.
      if (config.transport === "inMemory") continue;

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
      // client does (built-in servers don't use OAuth).
      if (!config.builtin) {
        const tokens = await this.getTokenStorage().getTokensAsync(config.id);
        if (tokens?.access_token) {
          headers.Authorization = `Bearer ${tokens.access_token}`;
        }
      }
      const entry: ClaudeHttpServer = { type: "http", url: config.url };
      if (Object.keys(headers).length > 0) entry.headers = headers;
      return entry;
    }

    return null;
  }

  /**
   * Maps the approval mode to Claude Code's permission flags:
   * - `yolo` → `--permission-mode bypassPermissions` (run every tool immediately).
   * - `ask` / `wait` → `--allowedTools <whitelist>` (only the whitelisted tools may run; anything
   *   else is denied by Claude rather than hanging on an interactive prompt the headless run can't answer).
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
          onStep?.({ type: "reasoning", reasoning: block.text });
        } else if (block.type === "tool_use") {
          onStep?.({
            type: "tool_call",
            toolName: block.name ?? "unknown",
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
