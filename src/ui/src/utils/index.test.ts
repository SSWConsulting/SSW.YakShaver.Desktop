import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { describe, expect, it } from "vitest";
import { MCPStepType } from "@/types";
import { formatKeyAsTitle, isWorkflowFailed } from "./";

function makeStep(status: WorkflowStatus) {
  return { stage: ProgressStage.UPLOADING_VIDEO, status };
}

function makeState(overrides: Partial<Record<keyof WorkflowState, WorkflowStatus>>): WorkflowState {
  const base: WorkflowState = {
    uploading_video: makeStep("not_started"),
    downloading_video: makeStep("not_started"),
    converting_audio: makeStep("not_started"),
    transcribing: makeStep("not_started"),
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
