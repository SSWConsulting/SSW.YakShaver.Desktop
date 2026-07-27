import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoShaves } from "./NoShaves";

describe("NoShaves (#966)", () => {
  it("uses a sad face emoji instead of the stop-sign emoji (AC1)", () => {
    render(<NoShaves />);

    const title = screen.getByText(/You don't have any YakShaves yet!/i);
    expect(title.textContent).toContain("😢");
    expect(title.textContent).not.toContain("⛔️");
  });

  it("has no dash between the emoji and the message text (AC2)", () => {
    render(<NoShaves />);

    const title = screen.getByText(/You don't have any YakShaves yet!/i);
    expect(title.textContent).toBe("😢 You don't have any YakShaves yet!");
    expect(title.textContent).not.toMatch(/-\s*You don't have any YakShaves yet!/);
  });
});
