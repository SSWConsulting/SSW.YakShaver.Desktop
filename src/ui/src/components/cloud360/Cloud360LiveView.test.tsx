import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cloud360EventPayload } from "@shared/types/cloud360";

const { onCloud360Event } = vi.hoisted(() => ({ onCloud360Event: vi.fn() }));
let emit: (p: Cloud360EventPayload) => void = () => {};
vi.mock("@/services/ipc-client", () => ({
  ipcClient: { pipelines: { onCloud360Event } },
}));

import { Cloud360LiveView } from "./Cloud360LiveView";

beforeEach(() => {
  onCloud360Event.mockReset();
  onCloud360Event.mockImplementation((cb: (p: Cloud360EventPayload) => void) => {
    emit = cb;
    return () => {};
  });
});

describe("Cloud360LiveView", () => {
  it("shows a status line", () => {
    render(<Cloud360LiveView />);
    act(() => emit({ event: { type: "status", message: "Creating sandbox..." } }));
    expect(screen.getByText("Creating sandbox...")).toBeInTheDocument();
  });

  it("renders a tool call parsed from a log event", () => {
    render(<Cloud360LiveView />);
    act(() =>
      emit({
        event: {
          type: "log",
          stream: "stdout",
          data: JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
          }),
        },
      }),
    );
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
  });

  it("renders the result card with an issue link", () => {
    render(<Cloud360LiveView />);
    act(() =>
      emit({
        event: {
          type: "result",
          summary: "Created issue",
          artifacts: ["https://github.com/a/b/issues/7"],
        },
      }),
    );
    const link = screen.getByRole("link", { name: /issues\/7/ });
    expect(link).toHaveAttribute("href", "https://github.com/a/b/issues/7");
  });

  it("renders an error row", () => {
    render(<Cloud360LiveView />);
    act(() => emit({ event: { type: "error", message: "Sandbox failed" } }));
    expect(screen.getByText("Sandbox failed")).toBeInTheDocument();
  });
});
