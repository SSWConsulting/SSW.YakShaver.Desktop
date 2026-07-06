import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProjects } = vi.hoisted(() => ({ listProjects: vi.fn() }));
vi.mock("@/services/ipc-client", () => ({ ipcClient: { cloud360: { listProjects } } }));

import { Cloud360ProjectDialog } from "./Cloud360ProjectDialog";

beforeEach(() => listProjects.mockClear());

describe("Cloud360ProjectDialog", () => {
  it("lists projects and confirms a selection", async () => {
    listProjects.mockResolvedValueOnce([
      { id: "1", name: "Widgets", githubRepo: "acme/widgets" },
      { id: "2", name: "Gadgets", githubRepo: "acme/gadgets" },
    ]);
    const onConfirm = vi.fn();
    render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await waitFor(() => expect(screen.getByText("Widgets")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(onConfirm).toHaveBeenCalledWith("2");
  });

  it("shows the empty state", async () => {
    listProjects.mockResolvedValueOnce([]);
    render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no github project/i)).toBeInTheDocument());
  });

  it("shows an error state when loading fails", async () => {
    listProjects.mockRejectedValueOnce(new Error("Not signed in"));
    render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument());
  });
});
