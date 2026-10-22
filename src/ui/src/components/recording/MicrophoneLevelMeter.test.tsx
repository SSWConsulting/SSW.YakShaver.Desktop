import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MicrophoneLevelMeter } from "./MicrophoneLevelMeter";

describe("MicrophoneLevelMeter", () => {
  it("exposes the current level to assistive tech", () => {
    render(<MicrophoneLevelMeter level={0.42} />);

    const meter = screen.getByRole("meter", { name: "Microphone input level" });
    expect(meter).toHaveAttribute("aria-valuenow", "42");
  });

  it("draws the fill outside a native <meter> so Chromium actually renders it", () => {
    // Chromium never renders children of a native <meter> (and aria-valuenow doesn't set its
    // value), so a bar nested inside one stays 0×0 and the meter looks dead for every mic.
    // jsdom does no layout, so assert the structure that makes the fill drawable.
    render(<MicrophoneLevelMeter level={0.5} />);

    const meter = screen.getByRole("meter");
    expect(meter.tagName).not.toBe("METER");
    const fill = meter.querySelector<HTMLElement>("[data-slot='meter-fill']");
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe("50%");
  });

  it("clamps out-of-range levels", () => {
    render(<MicrophoneLevelMeter level={3} />);

    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });
});
