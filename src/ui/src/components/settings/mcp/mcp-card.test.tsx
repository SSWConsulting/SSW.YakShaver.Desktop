import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { McpCard } from "./mcp-card";

const config = {
  id: "srv-1",
  name: "Acme",
  transport: "streamableHttp" as const,
  url: "https://example.com/mcp",
  enabled: true,
};

it("shows Reauthorize alongside Disconnect when authFailed (#1062)", () => {
  // Reauthorizing can be impossible (e.g. it needs a YakShaver sign-in), so the user must
  // always be able to turn a failing server off instead.
  const onReauthorize = vi.fn();
  const onDisconnect = vi.fn();
  render(
    <McpCard
      icon={<span />}
      config={config}
      viewMode="detailed"
      healthInfo={{ isHealthy: false, isChecking: false, authFailed: true }}
      onDisconnect={onDisconnect}
      onReauthorize={onReauthorize}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
  expect(onDisconnect).toHaveBeenCalled();
  // Reauthorize last: while it runs the card latches a single "Reauthorizing…" button (#982).
  fireEvent.click(screen.getByRole("button", { name: /reauthorize/i }));
  expect(onReauthorize).toHaveBeenCalled();
});

it("shows Disconnect (not Reauthorize) when unhealthy but not authFailed", () => {
  render(
    <McpCard
      icon={<span />}
      config={config}
      viewMode="detailed"
      healthInfo={{ isHealthy: false, isChecking: false, authFailed: false }}
      onDisconnect={vi.fn()}
      onReauthorize={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reauthorize/i })).toBeNull();
});
