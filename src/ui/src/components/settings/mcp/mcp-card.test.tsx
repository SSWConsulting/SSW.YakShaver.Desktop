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

it("shows Reauthorize (not Disconnect) when authFailed", () => {
  const onReauthorize = vi.fn();
  render(
    <McpCard
      icon={<span />}
      config={config}
      viewMode="detailed"
      healthInfo={{ isHealthy: false, isChecking: false, authFailed: true }}
      onDisconnect={vi.fn()}
      onReauthorize={onReauthorize}
    />,
  );
  expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
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
