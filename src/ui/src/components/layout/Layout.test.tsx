import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

// #998: while a workflow is in progress, the backend keeps emitting
// `workflow.onProgressNeo` events (one per step). Layout previously mounted
// `useWorkflowNavigation()` with its default (listening) behaviour for the
// lifetime of the app, so every one of those events — not just the first —
// force-navigated to `/workflow`, yanking the user off any page (e.g.
// Shaves) they'd intentionally navigated to while a run was still in
// progress. It also fought manual navigation into a specific shave's
// `/workflow/:shaveId` outcome view: the very next progress tick bounced the
// user straight back to the bare `/workflow` route.
vi.mock("./sidebar", () => ({ default: () => <div>Sidebar</div> }));

let capturedCb: (() => void) | undefined;
const onProgressNeo = vi.fn((cb: () => void) => {
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
  vi.clearAllMocks();
});

function renderAppShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Shaves Page</div>} />
          <Route path="/workflow" element={<div>Workflow Page</div>} />
          <Route path="/workflow/:shaveId" element={<div>Shave Outcome Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout (#998 Shaves page keeps switching back to in-progress workflow)", () => {
  it("stays on the current page across repeated workflow progress events", () => {
    renderAppShell("/");
    expect(screen.getByText("Shaves Page")).toBeInTheDocument();

    // Simulate the backend pushing several progress ticks while the user is
    // deliberately viewing Shaves during an in-progress workflow.
    act(() => capturedCb?.());
    act(() => capturedCb?.());
    act(() => capturedCb?.());

    // The user should remain on Shaves — no forced navigation away.
    expect(screen.getByText("Shaves Page")).toBeInTheDocument();
    expect(screen.queryByText("Workflow Page")).not.toBeInTheDocument();
  });

  it("does not bounce the user off a specific shave's outcome page back to the live workflow view", () => {
    renderAppShell("/workflow/shave-123");
    expect(screen.getByText("Shave Outcome Page")).toBeInTheDocument();

    act(() => capturedCb?.());

    expect(screen.getByText("Shave Outcome Page")).toBeInTheDocument();
    expect(screen.queryByText("Workflow Page")).not.toBeInTheDocument();
  });

  it("no longer subscribes to workflow progress events at all", () => {
    renderAppShell("/");
    expect(onProgressNeo).not.toHaveBeenCalled();
  });
});
