import {
  ProgressStage,
  WORKFLOW_STAGE_ORDER,
  type WorkflowState,
  type WorkflowStatus,
} from "@shared/types/workflow";
import { describe, expect, it } from "vitest";
import { formatKeyAsTitle, requiredPostCreationStageFailure } from "./";

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
