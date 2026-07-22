import {
  ProgressStage,
  WORKFLOW_STAGE_ORDER,
  type WorkflowState,
  type WorkflowStep,
} from "@shared/types/workflow";
import { type MCPStep, MCPStepType } from "@/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringValue(payload: unknown, key: string): string | undefined {
  return isRecord(payload) && typeof payload[key] === "string" ? payload[key] : undefined;
}

function isWorkflowState(value: unknown): value is WorkflowState {
  return isRecord(value) && WORKFLOW_STAGE_ORDER.every((key) => isRecord(value[key]));
}

export function parseWorkflowProgressNeoPayload(payload: unknown): {
  shaveId?: string;
  state?: WorkflowState;
} {
  if (isRecord(payload) && typeof payload.shaveId === "string" && isWorkflowState(payload.state)) {
    return {
      shaveId: payload.shaveId,
      state: payload.state,
    };
  }

  if (isWorkflowState(payload)) {
    return { state: payload };
  }

  return {};
}

export function parseWorkflowStepPayload(step?: WorkflowStep): unknown {
  if (!step?.payload) return undefined;

  try {
    return JSON.parse(step.payload);
  } catch {
    return step.payload;
  }
}

export function isWorkflowReadyForFinalOutput(state: WorkflowState): boolean {
  return (
    state.executing_task.status === "completed" &&
    ["completed", "failed", "skipped"].includes(state.updating_metadata.status)
  );
}

/**
 * #861/#672: the single source of truth for "a required post-creation stage failed", so the
 * persisted shave status (see useShaveManager) and the on-screen warning badge
 * (see FinalResultPanel) can never disagree about what counts as a clean success.
 *
 * The required post-creation stages are the video upload and the YouTube metadata update:
 * if either failed, the run is NOT a clean success even when the AI's final Status reads
 * "success". Returns the first failed stage plus a human-readable error message (the stage's
 * own payload error when present, otherwise a sensible default), or `null` when both stages
 * are non-failed — so any warning self-clears once a retry brings them back to a good state.
 * Upload failure takes precedence because it skips the metadata stage.
 */
const REQUIRED_POST_CREATION_STAGE_MESSAGES: ReadonlyArray<{
  stage: ProgressStage;
  defaultMessage: string;
}> = [
  {
    stage: ProgressStage.UPLOADING_VIDEO,
    defaultMessage: "The work item was created, but uploading the video to YouTube failed.",
  },
  {
    stage: ProgressStage.UPDATING_METADATA,
    defaultMessage: "The work item was created, but updating the YouTube video metadata failed.",
  },
];

export function requiredPostCreationStageFailure(
  state: WorkflowState,
): { stage: ProgressStage; error: string } | null {
  for (const { stage, defaultMessage } of REQUIRED_POST_CREATION_STAGE_MESSAGES) {
    const step = state[stage];
    if (step?.status === "failed") {
      return {
        stage,
        error: getStringValue(parseWorkflowStepPayload(step), "error") || defaultMessage,
      };
    }
  }
  return null;
}

/**
 * A single MCP step represents a failure when a tool result carried an error or a
 * tool call was denied. This is the canonical "did this step error" signal shared
 * by the per-step rendering and the panel-level failure predicate.
 */
export function isErrorStep(step: MCPStep): boolean {
  return (
    (step.type === MCPStepType.TOOL_RESULT && Boolean(step.error)) ||
    step.type === MCPStepType.TOOL_DENIED
  );
}

/**
 * The executing_task stage can report a raw status of "completed" while its payload
 * still contains error/denied steps (the backend completes the run whenever the
 * backlog item was created, regardless of mid-run tool errors). In that case the
 * run is effectively failed — WorkflowStepCard already renders it red. This helper
 * reads the parsed executing_task payload and reports whether it holds any error
 * steps so every consumer agrees on the same "effective failure" contract.
 */
export function hasExecutingTaskErrors(state: WorkflowState): boolean {
  const parsed = parseWorkflowStepPayload(state.executing_task);
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    return false;
  }
  return (parsed.steps as MCPStep[]).some(isErrorStep);
}

/**
 * A workflow run has failed when any of its stages reports a raw "failed" status,
 * OR when the executing_task stage completed but its payload contains error/denied
 * steps (the effective-failure case WorkflowStepCard already surfaces as red).
 *
 * Used to surface a clear/recover action on the processing screen so a stuck or
 * errored run can be dismissed instead of leaving the panel hung indefinitely.
 * Keeping this in lock-step with the per-step effective-failure logic ensures the
 * Clear action appears for every failure mode the user can actually see (#733).
 */
export function isWorkflowFailed(state: WorkflowState): boolean {
  return (
    WORKFLOW_STAGE_ORDER.some((stage) => state[stage].status === "failed") ||
    (state.executing_task.status === "completed" && hasExecutingTaskErrors(state))
  );
}

/**
 * Recursively parses JSON strings within nested objects and arrays.
 * If a string is valid JSON, it will be parsed and the function will continue parsing its contents.
 * Useful for deeply parsing objects that may contain JSON-encoded strings at any level.
 *
 * @param {unknown} obj - The object, array, or value to deeply parse.
 * @returns {unknown} The deeply parsed object, array, or value.
 */
export const deepParseJson = (obj: unknown): unknown => {
  if (typeof obj === "string") {
    try {
      const parsed = JSON.parse(obj);
      return deepParseJson(parsed);
    } catch {
      return obj;
    }
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepParseJson(item));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepParseJson(value);
    }
    return result;
  }
  return obj;
};

/**
 * Formats an unknown error into a string message.
 * Useful for handling errors in catch blocks where the error type is unknown.
 *
 * @param error - The error to format (can be Error, string, or any other type)
 * @returns The formatted error message as a string
 *
 * @example
 * ```ts
 * try {
 *   // some code
 * } catch (error) {
 *   console.error(formatErrorMessage(error));
 * }
 * ```
 */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strips the Electron IPC wrapper (`Error invoking remote method '…':`) and
 * leading `Error:` prefixes from an error, leaving the real reason for the
 * user (e.g. `HTTP 401: token expired or revoked`) (#982).
 */
export function formatIpcErrorMessage(error: unknown): string {
  return formatErrorMessage(error)
    .replace(/^Error invoking remote method '[^']*':\s*/i, "")
    .replace(/^(?:Error:\s*)+/i, "")
    .trim();
}

/**
 * Converts a camelCase or PascalCase key into a human-readable title with spaces.
 * Acronyms (consecutive uppercase letters) are kept together.
 *
 * @param key - The camelCase or PascalCase key to format.
 * @returns The formatted title string.
 *
 * @example
 * formatKeyAsTitle("projectPromptSelection") // "Project Prompt Selection"
 * formatKeyAsTitle("ProjectName")            // "Project Name"
 * formatKeyAsTitle("URLField")               // "URL Field"
 * formatKeyAsTitle("Title")                  // "Title"
 */
export function formatKeyAsTitle(key: string): string {
  return (
    key
      // Insert space between an acronym run and the next capitalised word: "URLField" → "URL Field"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // Insert space between a lowercase letter and the next uppercase letter: "camelCase" → "camel Case"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Capitalise the first character
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * Splits a raw MCP tool name into its raw (unformatted) server-prefix and tool-id
 * segments. Handles both the "__" (MCP system) and "." (AI output) separators and
 * is the single source of truth for the separator precedence and slice offsets that
 * {@link parseToolName} formats and consumers such as the approval dialog key off.
 *
 * @param rawToolName - The raw prefixed tool name from the MCP layer.
 * @returns An object with the raw `server` prefix (null if no prefix) and the raw
 *          `tool` id, both left exactly as they appear in the source string.
 *
 * @example
 * splitToolName("Jira__getAccessibleAtlassianResources")
 * // { server: "Jira", tool: "getAccessibleAtlassianResources" }
 *
 * splitToolName("Yak_Video_Tools.capture_video_frame")
 * // { server: "Yak_Video_Tools", tool: "capture_video_frame" }
 *
 * splitToolName("issue_write")
 * // { server: null, tool: "issue_write" }
 */
export function splitToolName(rawToolName: string): { server: string | null; tool: string } {
  // Handle "__" separator (MCP system format: "Jira__getAccessibleAtlassianResources")
  const dunderIndex = rawToolName.indexOf("__");
  if (dunderIndex !== -1) {
    return {
      server: rawToolName.slice(0, dunderIndex),
      tool: rawToolName.slice(dunderIndex + 2),
    };
  }

  // Handle "." separator (AI output format: "Yak_Video_Tools.capture_video_frame")
  const dotIndex = rawToolName.indexOf(".");
  if (dotIndex !== -1) {
    return {
      server: rawToolName.slice(0, dotIndex),
      tool: rawToolName.slice(dotIndex + 1),
    };
  }

  return { server: null, tool: rawToolName };
}

/**
 * Parses a raw MCP tool name (e.g. "Jira__getAccessibleAtlassianResources") into its
 * human-readable server and tool components.
 *
 * @param rawToolName - The raw prefixed tool name from the MCP layer.
 * @returns An object with `server` (null if no prefix) and `tool` as formatted strings.
 *
 * @example
 * parseToolName("Jira__getAccessibleAtlassianResources")
 * // { server: "Jira", tool: "Get Accessible Atlassian Resources" }
 *
 * parseToolName("GitHub__issue_write")
 * // { server: "GitHub", tool: "Issue Write" }
 */
export function parseToolName(rawToolName: string): { server: string | null; tool: string } {
  const formatTool = (s: string) => s.split("_").map(formatKeyAsTitle).join(" ");
  const formatServer = (s: string) => s.replace(/_/g, " ");

  const { server, tool } = splitToolName(rawToolName);
  return {
    server: server === null ? null : formatServer(server),
    tool: formatTool(tool),
  };
}

/**
 * Formats a raw MCP tool name into a user-friendly display string.
 *
 * @param rawToolName - The raw prefixed tool name from the MCP layer.
 * @returns A formatted string like "Jira: Get Accessible Atlassian Resources".
 *
 * @example
 * formatToolName("Jira__getAccessibleAtlassianResources")
 * // "Jira: Get Accessible Atlassian Resources"
 *
 * formatToolName("issue_write")
 * // "Issue Write"
 */
export function formatToolName(rawToolName: string): string {
  const { server, tool } = parseToolName(rawToolName);
  return server ? `${server}: ${tool}` : tool;
}

/**
 * Generates initials from a name string.
 * Returns the first letter of the first two words in uppercase.
 * Returns "U" if the name is undefined or empty.
 *
 * @param name - The full name to generate initials from.
 * @returns {string} The initials (up to 2 characters).
 */
export const getInitials = (name: string | undefined): string => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export type VersionBumpType = "major" | "minor" | "patch" | "prerelease" | "downgrade" | "unknown";

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The raw pre-release/build suffix (e.g. "-beta.941.123"), or "" if none. */
  suffix: string;
}

/**
 * Parses a `major.minor.patch` semver-style version string into its numeric
 * components plus its raw pre-release/build suffix. Tolerates a leading "v".
 * Requires a boundary (end-of-string, "-", or "+") immediately after the
 * patch digits, so strings like "1.2.3.4" or "1.2.3junk" — which aren't a
 * strict `major.minor.patch` (+ optional pre-release/build) — don't parse.
 *
 * @param version - The version string to parse.
 * @returns The parsed version, or `null` if it doesn't match.
 */
function parseVersion(version: string): ParsedVersion | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?=$|[-+])(.*)$/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: match[4] ?? "",
  };
}

/**
 * Determines whether upgrading from `currentVersion` to `newVersion` is a
 * major, minor, or patch bump, so the UI can communicate the nature of an
 * available update.
 *
 * @param currentVersion - The currently installed version string.
 * @param newVersion - The newly available version string.
 * @returns
 * - "major" | "minor" | "patch" when `newVersion` is a strictly higher
 *   major/minor/patch than `currentVersion`.
 * - "downgrade" when `newVersion`'s major/minor/patch is strictly lower than
 *   `currentVersion`'s (relevant for channels with `allowDowngrade: true`).
 * - "prerelease" when major/minor/patch are identical but the pre-release/
 *   build suffix differs (e.g. two PR-channel builds sharing the same base
 *   version, such as "0.6.0-beta.940.1" → "0.6.0-beta.941.1").
 * - "unknown" if either string can't be parsed, or the two versions are
 *   identical in full.
 *
 * @example
 * getVersionBumpType("1.2.3", "2.0.0") // "major"
 * getVersionBumpType("1.2.3", "1.3.0") // "minor"
 * getVersionBumpType("1.2.3", "1.2.4") // "patch"
 * getVersionBumpType("2.0.0", "1.9.0") // "downgrade"
 * getVersionBumpType("0.6.0-beta.940.1", "0.6.0-beta.941.1") // "prerelease"
 */
export function getVersionBumpType(
  currentVersion: string | undefined,
  newVersion: string | undefined,
): VersionBumpType {
  if (!currentVersion || !newVersion) return "unknown";

  const current = parseVersion(currentVersion);
  const next = parseVersion(newVersion);
  if (!current || !next) return "unknown";

  if (
    next.major !== current.major ||
    next.minor !== current.minor ||
    next.patch !== current.patch
  ) {
    if (next.major !== current.major) return next.major > current.major ? "major" : "downgrade";
    if (next.minor !== current.minor) return next.minor > current.minor ? "minor" : "downgrade";
    return next.patch > current.patch ? "patch" : "downgrade";
  }

  if (next.suffix !== current.suffix) return "prerelease";
  return "unknown";
}
