import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowProgressPanel } from "./WorkflowProgressPanel";
import { reconstructWorkflowState } from "./workflow-state-reconstruct";

// Render each step as just its label so we assert the panel's wiring, not the card internals.
vi.mock("./WorkflowStepCard", () => ({
  WorkflowStepCard: ({ label }: { label: string }) => <div>{label}</div>,
}));

// Control the live payload -> state parsing.
const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));
vi.mock("@/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils")>()),
  parseWorkflowProgressNeoPayload: parseMock,
}));

const completedState = reconstructWorkflowState("Completed");
if (!completedState) throw new Error("expected a reconstructed Completed state");

let capturedCb: ((payload: unknown) => void) | undefined;
const onProgressNeo = vi.fn((cb: (payload: unknown) => void) => {
  capturedCb = cb;
  return vi.fn(); // cleanup
});

beforeEach(() => {
  capturedCb = undefined;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    workflow: { onProgressNeo },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowProgressPanel (#821)", () => {
  it("live path: with no hydratedState it subscribes to onProgressNeo and renders a pushed state", () => {
    parseMock.mockReturnValue({ state: completedState, shaveId: "s1" });

    render(<WorkflowProgressPanel />);

    // It subscribed to the live event (the headline regression-safety guarantee)...
    expect(onProgressNeo).toHaveBeenCalledTimes(1);
    // ...and renders nothing until a payload arrives.
    expect(screen.queryByText("AI Workflow Progress")).toBeNull();

    act(() => capturedCb?.({ any: "payload" }));

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(screen.getByText("Uploading Video")).toBeInTheDocument();
  });

  it("hydrated path: with hydratedState it does NOT subscribe and renders the provided state", () => {
    render(<WorkflowProgressPanel hydratedState={completedState} />);

    expect(onProgressNeo).not.toHaveBeenCalled();
    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(screen.getByText("Executing Task")).toBeInTheDocument();
  });
});
