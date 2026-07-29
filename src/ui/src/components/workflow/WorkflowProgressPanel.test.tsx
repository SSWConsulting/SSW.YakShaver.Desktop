import type { WorkflowState } from "@shared/types/workflow";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowProgressPanel } from "./WorkflowProgressPanel";
import { reconstructWorkflowState } from "./workflow-state-reconstruct";

// Render each step as just its label so we assert the panel's wiring, not the card internals.
vi.mock("./WorkflowStepCard", () => ({
  WorkflowStepCard: ({ label, step }: { label: string; step: { status: string } }) => (
    <div>
      <span>{label}</span>
      <span>{step.status}</span>
    </div>
  ),
}));

// Control the live payload -> state parsing.
const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));
vi.mock("@/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils")>()),
  parseWorkflowProgressNeoPayload: parseMock,
}));

const completedState = reconstructWorkflowState("Completed");
if (!completedState) throw new Error("expected a reconstructed Completed state");

const { getState, onProgressNeo, progressCallbacks } = vi.hoisted(() => {
  const callbacks: Array<(payload: unknown) => void> = [];
  return {
    progressCallbacks: callbacks,
    getState: vi.fn(),
    onProgressNeo: vi.fn((callback: (payload: unknown) => void) => {
      callbacks.push(callback);
      return vi.fn();
    }),
  };
});

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: { workflow: { getState, onProgressNeo } },
}));

beforeEach(() => {
  progressCallbacks.length = 0;
  getState.mockResolvedValue({
    success: false,
    reason: "not_found",
    error: "Workflow not found",
  });
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

    act(() => progressCallbacks[0]?.({ any: "payload" }));

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(screen.getByText("Uploading Video")).toBeInTheDocument();
  });

  it("hydrated path: with hydratedState it does NOT subscribe and renders the provided state", () => {
    render(<WorkflowProgressPanel mode="hydrated" hydratedState={completedState} />);

    expect(onProgressNeo).not.toHaveBeenCalled();
    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(screen.getByText("Executing Task")).toBeInTheDocument();
  });

  it("selected live path: loads the current state immediately and ignores other shaves", async () => {
    const matchingState: WorkflowState = {
      ...completedState,
      uploading_video: { ...completedState.uploading_video, status: "in_progress" },
    };
    getState.mockResolvedValue({ success: true, state: completedState });
    parseMock.mockImplementation((payload: unknown) =>
      payload === "matching"
        ? { shaveId: "selected-shave", state: matchingState }
        : { shaveId: "other-shave", state: matchingState },
    );

    render(
      <WorkflowProgressPanel
        mode="selected"
        shaveId="selected-shave"
        onAvailabilityChange={vi.fn()}
      />,
    );

    expect((await screen.findByText("Uploading Video")).parentElement).toHaveTextContent(
      "Uploading Videocompleted",
    );
    expect(getState).toHaveBeenCalledWith("selected-shave");

    act(() => progressCallbacks[0]?.("other"));
    expect(screen.getByText("Uploading Video").parentElement).toHaveTextContent(
      "Uploading Videocompleted",
    );

    act(() => progressCallbacks[0]?.("matching"));
    expect(screen.getByText("Uploading Video").parentElement).toHaveTextContent(
      "Uploading Videoin_progress",
    );
  });

  it("selected live path: reports an unavailable in-memory workflow without an error toast", async () => {
    const onAvailabilityChange = vi.fn();
    parseMock.mockReturnValue({ shaveId: "missing-shave", state: completedState });

    render(
      <WorkflowProgressPanel
        mode="selected"
        shaveId="missing-shave"
        onAvailabilityChange={onAvailabilityChange}
      />,
    );

    await vi.waitFor(() => expect(onAvailabilityChange).toHaveBeenCalledWith(false));
    expect(toastError).not.toHaveBeenCalled();

    act(() => progressCallbacks[0]?.("matching-live-update"));

    expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
  });

  it("does not resubscribe when only the availability callback identity changes", async () => {
    getState.mockResolvedValue({ success: true, state: completedState });
    const { rerender } = render(
      <WorkflowProgressPanel
        mode="selected"
        shaveId="selected-shave"
        onAvailabilityChange={() => undefined}
      />,
    );

    await screen.findByText("AI Workflow Progress");
    rerender(
      <WorkflowProgressPanel
        mode="selected"
        shaveId="selected-shave"
        onAvailabilityChange={() => undefined}
      />,
    );

    expect(onProgressNeo).toHaveBeenCalledTimes(1);
    expect(getState).toHaveBeenCalledTimes(1);
  });

  it("selected live path: ignores a failed snapshot lookup after live progress arrives", async () => {
    let resolveGetState:
      | ((result: { success: false; reason: "not_found"; error: string }) => void)
      | undefined;
    getState.mockReturnValue(
      new Promise((resolve) => {
        resolveGetState = resolve;
      }),
    );
    parseMock.mockReturnValue({ shaveId: "selected-shave", state: completedState });
    const onAvailabilityChange = vi.fn();

    render(
      <WorkflowProgressPanel
        mode="selected"
        shaveId="selected-shave"
        onAvailabilityChange={onAvailabilityChange}
      />,
    );

    act(() => progressCallbacks[0]?.("matching"));
    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();

    await act(async () => {
      resolveGetState?.({
        success: false,
        reason: "not_found",
        error: "Workflow not found",
      });
    });

    expect(onAvailabilityChange).not.toHaveBeenCalledWith(false);
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
  });
});
