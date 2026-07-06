import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusDashboardErrorBoundary } from "./StatusDashboardErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

describe("StatusDashboardErrorBoundary (#948 review follow-up)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error to console.error too; keep test output clean.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleErrorSpy.mockRestore());

  it("contains a render error from its child instead of crashing the tree", () => {
    render(
      <div>
        <span>sidebar nav still here</span>
        <StatusDashboardErrorBoundary>
          <Boom />
        </StatusDashboardErrorBoundary>
      </div>,
    );

    expect(screen.getByText("sidebar nav still here")).toBeInTheDocument();
  });

  it("renders children normally when there is no error", () => {
    render(
      <StatusDashboardErrorBoundary>
        <span>dashboard content</span>
      </StatusDashboardErrorBoundary>,
    );

    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });
});
