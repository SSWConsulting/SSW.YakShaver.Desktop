import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHAVES_CHANGED_EVENT, type Shave, ShaveStatus } from "../../types";
import { ShaveAction } from "./ShaveAction";

const state = vi.hoisted(() => ({
  stop: vi.fn(),
  restart: vi.fn(),
  navigateToWorkflow: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: { workflow: { stop: state.stop, restart: state.restart } },
}));
vi.mock("@/hooks/useWorkflowNavigation", () => ({
  useWorkflowNavigation: () => state.navigateToWorkflow,
}));
vi.mock("sonner", () => ({ toast: { error: state.toastError } }));

function makeShave(shaveStatus: ShaveStatus): Shave {
  return { id: "shave-1", shaveStatus, workItemUrl: null } as Shave;
}

describe("ShaveAction (#1062)", () => {
  beforeEach(() => {
    state.stop.mockReset().mockResolvedValue({ success: true });
    state.restart.mockReset().mockResolvedValue({ success: true });
    state.navigateToWorkflow.mockReset();
    state.toastError.mockReset();
  });

  it("stops a processing shave and refreshes the list", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    window.addEventListener(SHAVES_CHANGED_EVENT, onChanged);
    render(<ShaveAction shave={makeShave(ShaveStatus.Processing)} />);

    await user.click(screen.getByRole("button", { name: /stop/i }));

    expect(state.stop).toHaveBeenCalledWith("shave-1");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    window.removeEventListener(SHAVES_CHANGED_EVENT, onChanged);
  });

  it.each([
    ShaveStatus.Failed,
    ShaveStatus.Cancelled,
  ])("retries a %s shave and opens its progress", async (status) => {
    const user = userEvent.setup();
    render(<ShaveAction shave={makeShave(status)} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(state.restart).toHaveBeenCalledWith("shave-1");
    await waitFor(() =>
      expect(state.navigateToWorkflow).toHaveBeenCalledWith({ shaveId: "shave-1" }),
    );
  });

  it("explains why a retry could not start and stays on the list", async () => {
    state.restart.mockResolvedValue({
      success: false,
      error: "The original recording is no longer available, so this shave can't be retried.",
    });
    const user = userEvent.setup();
    render(<ShaveAction shave={makeShave(ShaveStatus.Failed)} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith(
        "Failed to retry: The original recording is no longer available, so this shave can't be retried.",
      ),
    );
    expect(state.navigateToWorkflow).not.toHaveBeenCalled();
  });

  it("shows nothing actionable for a completed shave without a work item", () => {
    render(<ShaveAction shave={makeShave(ShaveStatus.Completed)} />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
