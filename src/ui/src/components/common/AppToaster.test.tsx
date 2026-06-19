import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock sonner's <Toaster> so we assert the `position` prop AppToaster passes —
// without depending on sonner's internal rendering, which portals and doesn't emit
// the [data-sonner-toaster] element in jsdom until a toast actually fires.
vi.mock("sonner", () => ({
  Toaster: (props: { position?: string }) => (
    <div data-testid="app-toaster" data-position={props.position ?? ""} />
  ),
}));

import { APP_TOAST_POSITION, AppToaster } from "./AppToaster";

describe("AppToaster (#784)", () => {
  it("exposes bottom-center as the toast position (AC1/AC3)", () => {
    // The exported constant is the contract the App wires into sonner's <Toaster>.
    expect(APP_TOAST_POSITION).toBe("bottom-center");
  });

  it("passes bottom-center (not the bottom-right default) to sonner's Toaster (AC1/AC2)", () => {
    render(<AppToaster />);
    const pos = screen.getByTestId("app-toaster").getAttribute("data-position");
    expect(pos).toBe("bottom-center");
    expect(pos).not.toBe("bottom-right");
  });
});
