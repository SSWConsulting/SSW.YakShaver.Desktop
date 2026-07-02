import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cloud360EventPayload } from "@shared/types/cloud360";

let emit: (p: Cloud360EventPayload) => void = () => {};
vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    pipelines: {
      onCloud360Event: (cb: (p: Cloud360EventPayload) => void) => {
        emit = cb;
        return () => {};
      },
    },
  },
}));

import { Cloud360Panel } from "./Cloud360Panel";

beforeEach(() => {
  emit = () => {};
});

describe("Cloud360Panel", () => {
  it("shows the latest status message", () => {
    render(<Cloud360Panel />);
    act(() => emit({ event: { type: "status", message: "Running YakShaver Agent..." } }));
    expect(screen.getByText("Running YakShaver Agent...")).toBeInTheDocument();
  });

  it("renders the issue link from a result event", () => {
    render(<Cloud360Panel />);
    act(() =>
      emit({
        event: { type: "result", summary: "Created issue", artifacts: ["https://github.com/a/b/issues/7"] },
      }),
    );
    expect(screen.getByText("Created issue")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /issues\/7/ });
    expect(link).toHaveAttribute("href", "https://github.com/a/b/issues/7");
  });

  it("renders an error message", () => {
    render(<Cloud360Panel />);
    act(() => emit({ event: { type: "error", message: "Sandbox failed" } }));
    expect(screen.getByText("Sandbox failed")).toBeInTheDocument();
  });
});
