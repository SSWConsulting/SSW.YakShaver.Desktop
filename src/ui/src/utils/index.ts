import {
  WORKFLOW_STAGE_ORDER,
  type WorkflowState,
  type WorkflowStep,
} from "@shared/types/workflow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
