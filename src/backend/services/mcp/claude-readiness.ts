import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OrchestratorReadiness } from "../../../shared/types/llm";
import type { IClaudeProcessSpawner } from "./local-claude-orchestrator";

export type { OrchestratorReadiness } from "../../../shared/types/llm";

/** Dependencies, injected so the unit tests stay pure (no real `claude`, no real FS/env). */
export interface ClaudeReadinessDeps {
  spawner: IClaudeProcessSpawner;
  /** Process environment to inspect for auth env vars. */
  env: NodeJS.ProcessEnv;
  /** Existence check for the credentials file (injectable for tests). */
  fileExists: (path: string) => boolean;
  /** Resolver for the user's home directory (injectable for tests). */
  homeDir: () => string;
  /** Command used to invoke the CLI. */
  claudeCommand: string;
}

const INSTALL_MESSAGE =
  "Claude Code CLI not found on PATH. Install it (npm i -g @anthropic-ai/claude-code), or switch the Orchestrator to OpenAI.";

const SIGN_IN_MESSAGE =
  "Claude Code is installed but not signed in. Run `claude` in a terminal and complete the login, then re-check — or switch the Orchestrator to OpenAI.";

/**
 * Auth env vars that let `claude -p` run without an interactive login. Mirrors Claude Code's
 * documented credential-precedence chain (cloud providers, bearer/API tokens, long-lived OAuth).
 */
const AUTH_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

export const defaultClaudeReadinessDeps: Omit<ClaudeReadinessDeps, "claudeCommand"> = {
  spawner: { spawn: (command, args) => spawn(command, args) },
  env: process.env,
  fileExists: (path) => existsSync(path),
  homeDir: () => homedir(),
};

/**
 * Resolve the path to Claude Code's credentials file, honouring `CLAUDE_CONFIG_DIR`
 * and otherwise falling back to `<home>/.claude/.credentials.json`.
 */
export function resolveCredentialsPath(env: NodeJS.ProcessEnv, homeDir: () => string): string {
  const baseDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homeDir(), ".claude");
  return join(baseDir, ".credentials.json");
}

/**
 * Best-effort, NON-BILLING authentication signal: an auth env var is set, OR a credentials file
 * exists at the resolved config dir.
 *
 * Known limitation: a macOS login that stores its token ONLY in the Keychain leaves no
 * credentials file, so this can report `false` for an actually-signed-in mac user. That is a
 * false "not ready" warning, never a false "ready" — and the run-time error path (which surfaces
 * Claude's own auth error) remains the authoritative check. A Keychain probe / `claude -p` probe
 * can be layered on later without changing this contract.
 */
export function detectClaudeAuth(env: NodeJS.ProcessEnv, deps: ClaudeReadinessDeps): boolean {
  const hasAuthEnv = AUTH_ENV_VARS.some((name) => {
    const value = env[name];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (hasAuthEnv) return true;

  return deps.fileExists(resolveCredentialsPath(env, deps.homeDir));
}

/** Spawn `claude --version` and resolve true iff it exits 0. Never rejects. */
function detectClaudeInstalled(deps: ClaudeReadinessDeps): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child: ChildProcess;
    try {
      child = deps.spawner.spawn(deps.claudeCommand, ["--version"]);
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Compute the readiness of the Claude Code orchestration backend: is the CLI installed, and
 * does it appear authenticated? Pure given its injected deps; never throws.
 */
export async function checkClaudeReadiness(
  deps: ClaudeReadinessDeps = { ...defaultClaudeReadinessDeps, claudeCommand: "claude" },
): Promise<OrchestratorReadiness> {
  const installed = await detectClaudeInstalled(deps);
  if (!installed) {
    return {
      installed: false,
      authenticated: false,
      ready: false,
      state: "not-installed",
      message: INSTALL_MESSAGE,
    };
  }

  const authenticated = detectClaudeAuth(deps.env, deps);
  if (!authenticated) {
    return {
      installed: true,
      authenticated: false,
      ready: false,
      state: "not-authenticated",
      message: SIGN_IN_MESSAGE,
    };
  }

  return { installed: true, authenticated: true, ready: true, state: "ready", message: "" };
}
