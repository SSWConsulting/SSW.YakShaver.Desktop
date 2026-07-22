import {
  ProgressStage,
  WORKFLOW_STAGE_ORDER,
  type WorkflowState,
  type WorkflowStatus,
} from "@shared/types/workflow";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Shave, ShaveStatus } from "../types";
import { HomePage } from "./HomePage";

// #591: MyShaves (HomePage) fetches the shave list once on mount but never
// re-fetches when a shave finishes processing elsewhere in the app. This test
// drives the same workflow.onProgressNeo event useShaveManager listens to and
// asserts HomePage picks up the resulting status change without a manual
// refresh/remount.
const { onProgressNeo, progressCallbacks, getAll, listServers } = vi.hoisted(() => {
  const callbacks: ((data: unknown) => void)[] = [];
  return {
    progressCallbacks: callbacks,
    onProgressNeo: vi.fn((cb: (data: unknown) => void) => {
      callbacks.push(cb);
      return () => {
        const idx = callbacks.indexOf(cb);
        if (idx !== -1) callbacks.splice(idx, 1);
      };
    }),
    getAll: vi.fn(),
    listServers: vi.fn(),
  };
});

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    workflow: { onProgressNeo },
    shave: { getAll },
    mcp: { listServers },
  },
}));

function buildState(overrides: Partial<Record<ProgressStage, WorkflowStatus>>): WorkflowState {
  const state = {} as WorkflowState;
  for (const stage of WORKFLOW_STAGE_ORDER) {
    const progressStage = stage as ProgressStage;
    state[stage] = { stage: progressStage, status: overrides[progressStage] ?? "not_started" };
  }
  return state;
}

function completedRun(finalOutput: string): WorkflowState {
  const state = buildState({
    [ProgressStage.UPLOADING_VIDEO]: "completed",
    [ProgressStage.DOWNLOADING_VIDEO]: "skipped",
    [ProgressStage.CONVERTING_AUDIO]: "completed",
    [ProgressStage.TRANSCRIBING]: "completed",
    [ProgressStage.OPTIMIZING_TRANSCRIPT]: "completed",
    [ProgressStage.ANALYZING_TRANSCRIPT]: "completed",
    [ProgressStage.SELECTING_PROMPT]: "completed",
    [ProgressStage.EXECUTING_TASK]: "completed",
    [ProgressStage.UPDATING_METADATA]: "completed",
  });
  state.executing_task = {
    stage: ProgressStage.EXECUTING_TASK,
    status: "completed",
    payload: JSON.stringify({ finalOutput }),
  };
  return state;
}

function emit(state: WorkflowState) {
  act(() => {
    for (const cb of progressCallbacks) {
      cb({ shaveId: "shave-1", state });
    }
  });
}

function makeShave(overrides: Partial<Shave>): Shave {
  return {
    id: "shave-1",
    clientOrigin: null,
    title: "Untitled",
    shaveStatus: ShaveStatus.Processing,
    projectName: null,
    workItemUrl: null,
    videoEmbedUrl: null,
    portalWorkItemId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function deferredGetAllResult(data: Shave[]) {
  let resolve!: (value: { success: true; data: Shave[] }) => void;
  const promise = new Promise<{ success: true; data: Shave[] }>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return {
    promise,
    resolve: () => resolve({ success: true, data }),
  };
}

describe("HomePage (#591 MyShaves re-render on shave completion)", () => {
  beforeEach(() => {
    progressCallbacks.length = 0;
    getAll.mockReset();
    listServers.mockReset();
    listServers.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("re-fetches and re-renders the shave list when a shave finishes processing", async () => {
    getAll.mockResolvedValueOnce({
      success: true,
      data: [makeShave({})],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText("Untitled");
    expect(screen.getByText(ShaveStatus.Processing)).toBeInTheDocument();
    expect(getAll).toHaveBeenCalledTimes(1);

    // The shave finishes processing elsewhere (e.g. useShaveManager persists the
    // final output). Simulate the subsequent DB state HomePage should reflect.
    getAll.mockResolvedValueOnce({
      success: true,
      data: [
        makeShave({
          title: "My Finished Work Item",
          shaveStatus: ShaveStatus.Completed,
          workItemUrl: "https://example.com/work-item/1",
        }),
      ],
    });

    emit(completedRun(JSON.stringify({ Status: "success", Title: "My Finished Work Item" })));

    // HomePage should re-fetch and re-render with the completed shave without
    // requiring a manual refresh or remount.
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    await screen.findByText("My Finished Work Item");
    expect(screen.getByText(ShaveStatus.Completed)).toBeInTheDocument();
  });

  it("does not let an older background refresh overwrite a newer response", async () => {
    getAll.mockResolvedValueOnce({
      success: true,
      data: [makeShave({ title: "Initial Shave" })],
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText("Initial Shave");

    const staleRefresh = deferredGetAllResult([
      makeShave({ title: "Stale Result", shaveStatus: ShaveStatus.Processing }),
    ]);
    const freshRefresh = deferredGetAllResult([
      makeShave({ title: "Fresh Result", shaveStatus: ShaveStatus.Completed }),
    ]);
    getAll.mockReturnValueOnce(staleRefresh.promise);
    getAll.mockReturnValueOnce(freshRefresh.promise);

    emit(completedRun(JSON.stringify({ Status: "success", Title: "Stale Result" })));
    emit(completedRun(JSON.stringify({ Status: "success", Title: "Fresh Result" })));

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(3));

    await act(async () => {
      freshRefresh.resolve();
    });

    await screen.findByText("Fresh Result");

    await act(async () => {
      staleRefresh.resolve();
    });

    expect(screen.getByText("Fresh Result")).toBeInTheDocument();
    expect(screen.queryByText("Stale Result")).not.toBeInTheDocument();
  });
});
