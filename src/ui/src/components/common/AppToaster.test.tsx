import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";
import { APP_TOAST_POSITION, AppToaster } from "./AppToaster";

// These tests render the REAL sonner <Toaster> (no mock) and fire an actual
// toast() so sonner mounts its portal and emits [data-sonner-toaster]. We then
// assert the rendered anchor attributes, proving the toast is anchored
// bottom-center (and not the default bottom-right) — the outcome #784 claims —
// rather than just verifying the prop pass-through.

afterEach(() => {
  // Clear any toasts queued by a test so its portal doesn't leak into the next.
  toast.dismiss();
});

describe("AppToaster (#784)", () => {
  it("exposes bottom-center as the toast position contract (AC1/AC3)", () => {
    // The exported constant is the contract App wires into sonner's <Toaster>.
    expect(APP_TOAST_POSITION).toBe("bottom-center");
  });

  it("renders the toast anchored bottom-center, not bottom-right (AC1/AC2)", async () => {
    render(<AppToaster />);

    act(() => {
      toast("Yak shaved");
    });

    // Sonner only mounts [data-sonner-toaster] once a toast actually fires.
    const toaster = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toaster]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // Assert the real rendered anchor sonner computed from the position prop —
    // not a pass-through of our own constant.
    expect(toaster.getAttribute("data-y-position")).toBe("bottom");
    expect(toaster.getAttribute("data-x-position")).toBe("center");
    // Explicitly guard against a regression back to the default bottom-right.
    expect(toaster.getAttribute("data-x-position")).not.toBe("right");
  });
});
