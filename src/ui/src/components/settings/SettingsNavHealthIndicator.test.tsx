import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsNavHealthIndicator } from "./SettingsNavHealthIndicator";
import type { SettingsTabHealth } from "./settings-health";

const health: SettingsTabHealth = {
  tabId: "mcp",
  severity: "critical",
  message: "GitHub is disconnected. New backlog items can't be created until reconnected.",
};

describe("SettingsNavHealthIndicator", () => {
  it("exposes the issue as the icon's accessible name", () => {
    render(<SettingsNavHealthIndicator health={health} />);
    const icon = screen.getByRole("img");
    expect(icon.getAttribute("aria-label")).toContain(health.message);
  });

  it("renders the issue text in a tooltip", () => {
    render(<SettingsNavHealthIndicator health={health} />);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("GitHub is disconnected");
  });
});
