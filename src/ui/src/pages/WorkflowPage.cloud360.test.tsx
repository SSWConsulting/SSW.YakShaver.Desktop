import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/cloud360/Cloud360LiveView", () => ({
  Cloud360LiveView: () => <div>live-view-360</div>,
}));
vi.mock("../components/workflow/WorkflowProgressPanel", () => ({
  WorkflowProgressPanel: () => <div>local-progress-panel</div>,
}));
vi.mock("../components/workflow/FinalResultPanel", () => ({
  FinalResultPanel: () => null,
}));
vi.mock("../components/workflow/ShaveOutcomeView", () => ({
  ShaveOutcomeView: () => <div>shave-outcome</div>,
}));

import { WorkflowPage } from "./WorkflowPage";

function renderAt(entry: { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="/workflow/:shaveId" element={<WorkflowPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkflowPage 360 routing", () => {
  it("renders the 360 live view when backend snapshot is cloud-360", () => {
    renderAt({ pathname: "/workflow", state: { backend: "cloud-360" } });
    expect(screen.getByText("live-view-360")).toBeInTheDocument();
    expect(screen.queryByText("local-progress-panel")).not.toBeInTheDocument();
  });

  it("renders the local panel when there is no 360 snapshot", () => {
    renderAt({ pathname: "/workflow" });
    expect(screen.getByText("local-progress-panel")).toBeInTheDocument();
    expect(screen.queryByText("live-view-360")).not.toBeInTheDocument();
  });
});
