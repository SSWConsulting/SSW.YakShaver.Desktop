import { type ChildProcess, spawn } from "node:child_process";

/**
 * Minimal child-process spawner seam. Services depend on this interface (not `child_process`
 * directly) so unit tests can inject a mock child and assert on the exact command/argv without
 * ever launching a real process. Shared by `FFmpegService` and `LocalClaudeOrchestrator`.
 */
export interface IProcessSpawner {
  spawn(command: string, args: string[]): ChildProcess;
}

/** Spawns the command directly. Suitable for absolute, executable binary paths. */
export const defaultProcessSpawner: IProcessSpawner = {
  spawn: (command, args) => spawn(command, args),
};
