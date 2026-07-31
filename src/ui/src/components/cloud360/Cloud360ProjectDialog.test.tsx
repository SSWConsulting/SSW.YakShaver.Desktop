import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProjects, checkCredits, openExternal } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  checkCredits: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("@/services/ipc-client", () => ({
  ipcClient: { cloud360: { listProjects, checkCredits }, app: { openExternal } },
}));

import { Cloud360ProjectDialog } from "./Cloud360ProjectDialog";

beforeEach(() => {
  listProjects.mockClear();
  // Default to a tenant that can shave, so the pre-existing cases below still exercise the list.
  checkCredits.mockReset().mockResolvedValue({ canShave: true });
  openExternal.mockReset();
});

describe("Cloud360ProjectDialog", () => {
  it("lists projects (name + repo) and confirms on selecting one", async () => {
    listProjects.mockResolvedValueOnce([
      { id: "1", name: "Widgets", githubRepo: "acme/widgets" },
      { id: "2", name: "Gadgets", githubRepo: "acme/gadgets" },
    ]);
    const onConfirm = vi.fn();
    render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await waitFor(() => expect(screen.getByText("Widgets")).toBeInTheDocument());
    // Selecting a project immediately proceeds — no separate confirm button (mirrors web).
    expect(screen.getByText("acme/gadgets")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Gadgets"));
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

  // Issue #3899: this dialog is the last point before the source picker opens, so blocking here is
  // what actually spares the user recording a video that can never be processed.
  describe("credit pre-check", () => {
    it("withholds the project list and explains why when credits are spent", async () => {
      listProjects.mockResolvedValueOnce([
        { id: "1", name: "Widgets", githubRepo: "acme/widgets" },
      ]);
      checkCredits.mockResolvedValue({ canShave: false, reason: "out-of-credits" });
      render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Out of credits")).toBeInTheDocument());
      expect(screen.queryByText("Widgets")).not.toBeInTheDocument();
      // Nothing to filter, so the search box goes too.
      expect(screen.queryByPlaceholderText("Search projects...")).not.toBeInTheDocument();
    });

    it("distinguishes having no plan from having spent one", async () => {
      listProjects.mockResolvedValueOnce([]);
      checkCredits.mockResolvedValue({ canShave: false, reason: "no-subscription" });
      render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("No active subscription")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "View plans" })).toBeInTheDocument();
    });

    it("opens billing in the system browser", async () => {
      listProjects.mockResolvedValueOnce([]);
      checkCredits.mockResolvedValue({ canShave: false, reason: "out-of-credits" });
      render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

      const button = await screen.findByRole("button", { name: "Manage plan" });
      fireEvent.click(button);
      expect(openExternal).toHaveBeenCalledWith("https://portal.yakshaver.ai/plan");
    });

    // Fails open: a broken pre-check must never be the thing that stops a paying user.
    it("still lists projects when the credit check itself throws", async () => {
      listProjects.mockResolvedValueOnce([
        { id: "1", name: "Widgets", githubRepo: "acme/widgets" },
      ]);
      checkCredits.mockRejectedValue(new Error("ipc exploded"));
      render(<Cloud360ProjectDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("Widgets")).toBeInTheDocument());
    });
  });
});
