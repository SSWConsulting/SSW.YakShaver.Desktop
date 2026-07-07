import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusDashboardErrorBoundary } from "./StatusDashboardErrorBoundary";
import { STATUS_DASHBOARD_REFRESH_EVENT } from "./status-dashboard";

function Boom(): never {
  throw new Error("boom");
}

/** Throws while `shouldThrow.current` is true, renders normally once cleared — models a
 * transient render error (e.g. one bad IPC payload tick) that clears up on the next retry,
 * rather than a persistently broken child. */
function FlakyChild({ shouldThrow }: { shouldThrow: { current: boolean } }) {
  if (shouldThrow.current) {
    throw new Error("transient boom");
  }
  return <span>dashboard content</span>;
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

  it("address review #949: self-heals on STATUS_DASHBOARD_REFRESH_EVENT instead of staying blanked forever", () => {
    const shouldThrow = { current: true };
    render(
      <StatusDashboardErrorBoundary>
        <FlakyChild shouldThrow={shouldThrow} />
      </StatusDashboardErrorBoundary>,
    );

    // The transient error trips the boundary — the dashboard renders nothing.
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();

    // The underlying cause has cleared (e.g. a fresh IPC read on the next tick); the same
    // refresh trigger useStatusDashboard already re-checks on (Settings-close / auth-change)
    // should let the boundary retry, and the child now renders cleanly.
    shouldThrow.current = false;
    act(() => {
      window.dispatchEvent(new CustomEvent(STATUS_DASHBOARD_REFRESH_EVENT));
    });

    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("address review #949: self-heals on window focus too", () => {
    const shouldThrow = { current: true };
    render(
      <StatusDashboardErrorBoundary>
        <FlakyChild shouldThrow={shouldThrow} />
      </StatusDashboardErrorBoundary>,
    );

    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();

    shouldThrow.current = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });
});
