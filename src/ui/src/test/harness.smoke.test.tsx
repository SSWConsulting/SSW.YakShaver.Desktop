import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// A trivial inline component proves the harness end-to-end: the @vitejs/plugin-react
// JSX transform, rendering into jsdom, and querying with RTL. Uses a plain assertion
// (getByText throws if absent) rather than a jest-dom matcher, so the build's `tsc`
// never depends on the jest-dom type augmentation. jest-dom IS installed + wired in
// src/test/setup.ts for the real component/wiring tests (#803/#869/#821/#879) that
// land per-feature once this harness is in.
function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("UI component-test harness (jsdom + RTL)", () => {
  it("renders a React component and can query its text", () => {
    render(<Greeting name="YakShaver" />);
    // getByText throws if the node isn't rendered, so reaching this assertion
    // already proves the render + query path; the textContent check is belt-and-braces.
    expect(screen.getByText("Hello YakShaver").textContent).toBe("Hello YakShaver");
  });
});
