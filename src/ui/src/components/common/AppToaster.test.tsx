import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_TOAST_POSITION, AppToaster } from "./AppToaster";

describe("AppToaster (#784)", () => {
  it("exposes bottom-center as the toast position (AC1/AC3)", () => {
    // The exported constant is the contract the App wires into sonner's <Toaster>.
    expect(APP_TOAST_POSITION).toBe("bottom-center");
  });

  it("renders the sonner toaster anchored bottom-center, not bottom-right (AC1/AC2)", () => {
    const { container } = render(<AppToaster />);

    // sonner emits the rendered container with data-sonner-toaster and splits the
    // position into x/y axis attributes.
    const toaster = container.querySelector("[data-sonner-toaster]");
    expect(toaster).not.toBeNull();
    expect(toaster?.getAttribute("data-y-position")).toBe("bottom");
    expect(toaster?.getAttribute("data-x-position")).toBe("center");
    // explicitly assert it is NOT the old bottom-right default
    expect(toaster?.getAttribute("data-x-position")).not.toBe("right");
  });
});
