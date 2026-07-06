import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProjects } = vi.hoisted(() => ({ listProjects: vi.fn() }));
vi.mock("@/services/ipc-client", () => ({
  ipcClient: { cloud360: { listProjects } },
}));

import { Cloud360ProjectPicker } from "./Cloud360ProjectPicker";

// mockClear (not mockReset) + *Once value setters — every test sets its own
// one-shot resolved/rejected value before rendering, so clearing call history
// is all that's needed between tests. Using persistent mockResolvedValue /
// mockRejectedValue here (as the naive version of this test does) triggers a
// spurious Node "unhandledRejection" in this vitest version: swapping a
// mock's persistent implementation races the component's own .catch() across
// a microtask boundary, even though the rejection IS handled. The *Once
// variants sidestep that by not leaving a persistent implementation behind.
beforeEach(() => listProjects.mockClear());

describe("Cloud360ProjectPicker", () => {
  it("lists projects and reports selection", async () => {
    listProjects.mockResolvedValueOnce([
      { id: "1", name: "Widgets", githubRepo: "acme/widgets" },
      { id: "2", name: "Gadgets", githubRepo: "acme/gadgets" },
    ]);
    const onChange = vi.fn();
    render(<Cloud360ProjectPicker value={null} onChange={onChange} />);

    await waitFor(() => expect(screen.getByText("Widgets")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("shows an empty-state message when there are no GitHub projects", async () => {
    listProjects.mockResolvedValueOnce([]);
    render(<Cloud360ProjectPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no github project/i)).toBeInTheDocument());
  });

  it("shows an error state when loading fails", async () => {
    listProjects.mockRejectedValueOnce(new Error("Not signed in"));
    render(<Cloud360ProjectPicker value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument());
  });
});
