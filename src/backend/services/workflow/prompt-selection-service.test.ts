import { describe, expect, it, vi } from "vitest";
import type { LanguageModelProvider } from "../mcp/language-model-provider";
import { PromptSelectionService } from "./prompt-selection-service";
import {
  WORKFLOW_STOPPED_BY_USER_MESSAGE,
  WorkflowCancelledError,
} from "./workflow-cancelled-error";

const requestProjectSelection = vi.fn();

// The real PromptManager reaches for portal auth/config/storage singletons; the selection logic
// under test only needs the prompt list and the details lookup.
vi.mock("../prompt/prompt-manager", () => ({
  PromptManager: {
    getInstance: () => ({
      getAllPrompts: async () => [
        { id: "proj-1", name: "My Project", description: "The primary project", source: "local" },
      ],
      getProjectDetails: async () => ({
        id: "proj-1",
        name: "My Project",
        desktopAgentProjectPrompt: "Create the issue.",
      }),
    }),
  },
}));

vi.mock("../user-interaction/user-interaction-service", () => ({
  UserInteractionService: { getInstance: () => ({ requestProjectSelection }) },
}));

function makeModelProvider(): LanguageModelProvider {
  return {
    generateObject: vi.fn().mockResolvedValue({ id: "proj-1", reason: "Best match" }),
  } as unknown as LanguageModelProvider;
}

describe("PromptSelectionService stop handling", () => {
  it("aborts the workflow when the user stops from the confirmation dialog", async () => {
    requestProjectSelection.mockResolvedValueOnce({ kind: "stop" });

    await expect(
      PromptSelectionService.getInstance().getConfirmedProjectDetails(
        makeModelProvider(),
        "a transcript",
      ),
    ).rejects.toThrow(WorkflowCancelledError);
  });

  it("reports the stop as a user-facing outcome rather than an internal error", async () => {
    requestProjectSelection.mockResolvedValueOnce({ kind: "stop" });

    await expect(
      PromptSelectionService.getInstance().getConfirmedProjectDetails(
        makeModelProvider(),
        "a transcript",
      ),
    ).rejects.toThrow(WORKFLOW_STOPPED_BY_USER_MESSAGE);
  });

  it("still returns the confirmed prompt when the user selects one", async () => {
    requestProjectSelection.mockResolvedValueOnce({ kind: "select", projectId: "proj-1" });

    const details = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
      makeModelProvider(),
      "a transcript",
    );

    expect(details?.name).toBe("My Project");
    expect(details?.selectionReason).toBe("Best match");
  });
});
