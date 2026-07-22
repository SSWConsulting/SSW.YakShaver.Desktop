import {
  ProgressStage,
  WORKFLOW_STAGE_ORDER,
  type WorkflowState,
  type WorkflowStatus,
} from "@shared/types/workflow";
import { describe, expect, it } from "vitest";
import { MCPStepType } from "@/types";
import {
  formatIpcErrorMessage,
  formatKeyAsTitle,
  getVersionBumpType,
  isWorkflowFailed,
  parseToolName,
  requiredPostCreationStageFailure,
  splitToolName,
} from "./";

function makeWorkflowState(
  overrides: Partial<Record<ProgressStage, { status: WorkflowStatus; payload?: string }>> = {},
): WorkflowState {
  const state = {} as WorkflowState;
  for (const stage of WORKFLOW_STAGE_ORDER) {
    const override = overrides[stage as ProgressStage];
    state[stage] = {
      stage: stage as ProgressStage,
      status: override?.status ?? "completed",
      payload: override?.payload,
    };
  }
  return state;
}

function makeStep(status: WorkflowStatus) {
  return { stage: ProgressStage.UPLOADING_VIDEO, status };
}

function makeState(overrides: Partial<Record<keyof WorkflowState, WorkflowStatus>>): WorkflowState {
  const base: WorkflowState = {
    uploading_video: makeStep("not_started"),
    downloading_video: makeStep("not_started"),
    converting_audio: makeStep("not_started"),
    transcribing: makeStep("not_started"),
    optimizing_transcript: makeStep("not_started"),
    analyzing_transcript: makeStep("not_started"),
    selecting_prompt: makeStep("not_started"),
    executing_task: makeStep("not_started"),
    updating_metadata: makeStep("not_started"),
  };
  for (const [key, status] of Object.entries(overrides)) {
    base[key as keyof WorkflowState] = makeStep(status as WorkflowStatus);
  }
  return base;
}

describe("formatIpcErrorMessage", () => {
  it("strips the Electron IPC wrapper and leading Error: chain, keeping the real reason", () => {
    const raw = new Error(
      "Error invoking remote method 'mcp:list-server-tools': Error: MCPClientError: MCP HTTP Transport Error: POSTing to endpoint (HTTP 401): token expired or revoked",
    );
    expect(formatIpcErrorMessage(raw)).toBe(
      "MCPClientError: MCP HTTP Transport Error: POSTing to endpoint (HTTP 401): token expired or revoked",
    );
  });

  it("leaves an already-clean message untouched", () => {
    expect(formatIpcErrorMessage(new Error("HTTP 401: token expired or revoked"))).toBe(
      "HTTP 401: token expired or revoked",
    );
  });

  it("handles non-Error values", () => {
    expect(formatIpcErrorMessage("plain string reason")).toBe("plain string reason");
  });
});

describe("formatKeyAsTitle", () => {
  it("converts camelCase to spaced title case", () => {
    expect(formatKeyAsTitle("projectPromptSelection")).toBe("Project Prompt Selection");
  });

  it("converts PascalCase to spaced title case", () => {
    expect(formatKeyAsTitle("ProjectName")).toBe("Project Name");
  });

  it("keeps acronyms together and inserts space before the next word", () => {
    expect(formatKeyAsTitle("URLField")).toBe("URL Field");
  });

  it("handles leading acronym followed by more words", () => {
    expect(formatKeyAsTitle("MyURLField")).toBe("My URL Field");
  });

  it("leaves a single already-readable word unchanged", () => {
    expect(formatKeyAsTitle("Title")).toBe("Title");
  });

  it("capitalises a lowercase-starting key", () => {
    expect(formatKeyAsTitle("issueNumber")).toBe("Issue Number");
  });

  it("handles a single lowercase word", () => {
    expect(formatKeyAsTitle("status")).toBe("Status");
  });

  it("handles consecutive uppercase acronyms separated by words", () => {
    expect(formatKeyAsTitle("parseHTMLContent")).toBe("Parse HTML Content");
  });
});

describe("requiredPostCreationStageFailure", () => {
  it("returns null when no required post-creation stage failed", () => {
    expect(requiredPostCreationStageFailure(makeWorkflowState())).toBeNull();
  });

  it("flags a failed video upload with a default message", () => {
    const result = requiredPostCreationStageFailure(
      makeWorkflowState({ [ProgressStage.UPLOADING_VIDEO]: { status: "failed" } }),
    );
    expect(result).toEqual({
      stage: ProgressStage.UPLOADING_VIDEO,
      error: "The work item was created, but uploading the video to YouTube failed.",
    });
  });

  it("flags a failed metadata update with a default message", () => {
    const result = requiredPostCreationStageFailure(
      makeWorkflowState({ [ProgressStage.UPDATING_METADATA]: { status: "failed" } }),
    );
    expect(result).toEqual({
      stage: ProgressStage.UPDATING_METADATA,
      error: "The work item was created, but updating the YouTube video metadata failed.",
    });
  });

  it("prefers the stage's own payload error message when present", () => {
    const result = requiredPostCreationStageFailure(
      makeWorkflowState({
        [ProgressStage.UPDATING_METADATA]: {
          status: "failed",
          payload: JSON.stringify({ error: "quota exceeded" }),
        },
      }),
    );
    expect(result).toEqual({
      stage: ProgressStage.UPDATING_METADATA,
      error: "quota exceeded",
    });
  });

  it("gives upload failure precedence over a metadata failure", () => {
    const result = requiredPostCreationStageFailure(
      makeWorkflowState({
        [ProgressStage.UPLOADING_VIDEO]: { status: "failed" },
        [ProgressStage.UPDATING_METADATA]: { status: "failed" },
      }),
    );
    expect(result?.stage).toBe(ProgressStage.UPLOADING_VIDEO);
  });
});

describe("isWorkflowFailed", () => {
  it("returns true when any stage has failed", () => {
    expect(isWorkflowFailed(makeState({ executing_task: "failed" }))).toBe(true);
  });

  it("returns true when the first stage fails early", () => {
    expect(isWorkflowFailed(makeState({ uploading_video: "failed" }))).toBe(true);
  });

  it("returns false while a run is still in progress", () => {
    expect(isWorkflowFailed(makeState({ uploading_video: "in_progress" }))).toBe(false);
  });

  it("returns false for a fully completed run", () => {
    const completed = makeState({});
    for (const key of Object.keys(completed) as (keyof WorkflowState)[]) {
      completed[key] = makeStep("completed");
    }
    expect(isWorkflowFailed(completed)).toBe(false);
  });

  it("returns true when executing_task completed but its payload has a tool-error step", () => {
    const state = makeState({ executing_task: "completed" });
    state.executing_task.payload = JSON.stringify({
      steps: [{ type: MCPStepType.TOOL_RESULT, error: "boom" }],
    });
    expect(isWorkflowFailed(state)).toBe(true);
  });

  it("returns true when executing_task completed but its payload has a tool-denied step", () => {
    const state = makeState({ executing_task: "completed" });
    state.executing_task.payload = JSON.stringify({
      steps: [{ type: MCPStepType.TOOL_DENIED, message: "denied" }],
    });
    expect(isWorkflowFailed(state)).toBe(true);
  });

  it("returns false when executing_task completed with only successful steps", () => {
    const state = makeState({ executing_task: "completed" });
    state.executing_task.payload = JSON.stringify({
      steps: [{ type: MCPStepType.TOOL_RESULT, result: "ok" }],
    });
    expect(isWorkflowFailed(state)).toBe(false);
  });
});

describe("splitToolName", () => {
  it("splits on the '__' MCP system separator", () => {
    expect(splitToolName("Jira__getAccessibleAtlassianResources")).toEqual({
      server: "Jira",
      tool: "getAccessibleAtlassianResources",
    });
  });

  it("splits on the '.' AI-output separator", () => {
    expect(splitToolName("Yak_Video_Tools.capture_video_frame")).toEqual({
      server: "Yak_Video_Tools",
      tool: "capture_video_frame",
    });
  });

  it("prefers the '__' separator over '.' when both are present", () => {
    expect(splitToolName("Yak_Video_Tools__capture_video_frame")).toEqual({
      server: "Yak_Video_Tools",
      tool: "capture_video_frame",
    });
  });

  it("returns a null server when there is no prefix", () => {
    expect(splitToolName("issue_write")).toEqual({ server: null, tool: "issue_write" });
  });
});

describe("parseToolName", () => {
  it("formats a '__'-separated tool name", () => {
    expect(parseToolName("Jira__getAccessibleAtlassianResources")).toEqual({
      server: "Jira",
      tool: "Get Accessible Atlassian Resources",
    });
  });

  it("formats a '.'-separated tool name and de-underscores the server", () => {
    expect(parseToolName("Yak_Video_Tools.capture_video_frame")).toEqual({
      server: "Yak Video Tools",
      tool: "Capture Video Frame",
    });
  });

  it("returns a null server for an unprefixed tool name", () => {
    expect(parseToolName("issue_write")).toEqual({ server: null, tool: "Issue Write" });
  });
});

describe("getVersionBumpType", () => {
  it("detects a major bump", () => {
    expect(getVersionBumpType("1.2.3", "2.0.0")).toBe("major");
  });

  it("detects a minor bump", () => {
    expect(getVersionBumpType("1.2.3", "1.3.0")).toBe("minor");
  });

  it("detects a patch bump", () => {
    expect(getVersionBumpType("1.2.3", "1.2.4")).toBe("patch");
  });

  it("tolerates a leading 'v' and pre-release/build suffixes", () => {
    expect(getVersionBumpType("v1.2.3", "v1.2.4-beta.1")).toBe("patch");
  });

  it("returns 'unknown' for identical versions", () => {
    expect(getVersionBumpType("1.2.3", "1.2.3")).toBe("unknown");
  });

  it("returns 'unknown' when either version is missing or unparsable", () => {
    expect(getVersionBumpType(undefined, "1.2.3")).toBe("unknown");
    expect(getVersionBumpType("1.2.3", undefined)).toBe("unknown");
    expect(getVersionBumpType("not-a-version", "1.2.3")).toBe("unknown");
  });

  it("returns 'unknown' for a version with a trailing extra numeric component (not strict major.minor.patch)", () => {
    expect(getVersionBumpType("1.2.3", "1.2.3.4")).toBe("unknown");
  });

  it("returns 'unknown' for a version with unrecognised trailing characters (no '-'/'+' boundary)", () => {
    expect(getVersionBumpType("1.2.3", "1.2.3junk")).toBe("unknown");
  });

  it("detects a 'major' downgrade as 'downgrade'", () => {
    expect(getVersionBumpType("2.0.0", "1.9.0")).toBe("downgrade");
  });

  it("detects a 'minor' downgrade as 'downgrade'", () => {
    expect(getVersionBumpType("1.5.0", "1.2.0")).toBe("downgrade");
  });

  it("detects a 'patch' downgrade as 'downgrade'", () => {
    expect(getVersionBumpType("1.2.5", "1.2.1")).toBe("downgrade");
  });

  it("labels a pre-release/build-only difference as 'prerelease' rather than 'unknown' (PR/beta channel, AC3)", () => {
    expect(getVersionBumpType("0.6.0-beta.940.1700000000000", "0.6.0-beta.941.1700000001000")).toBe(
      "prerelease",
    );
  });

  it("labels a bare-to-prerelease suffix difference as 'prerelease' when major.minor.patch match", () => {
    expect(getVersionBumpType("1.2.3", "1.2.3-beta.1")).toBe("prerelease");
  });
});
