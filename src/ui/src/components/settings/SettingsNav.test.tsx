import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsNav } from "./SettingsNav";

const tabs = [
  { id: "general", label: "General" },
  { id: "videoHost", label: "Video Host" },
  { id: "account", label: "Account" },
  { id: "release", label: "Releases" },
];

function setup(activeTabId = "general") {
  const onSelect = vi.fn();
  render(<SettingsNav tabs={tabs} activeTabId={activeTabId} onSelect={onSelect} />);
  const buttons = screen.getAllByRole("tab");
  return { onSelect, buttons };
}

describe("SettingsNav (#803) keyboard navigation", () => {
  it("moves focus with ArrowDown/ArrowUp/Home/End without selecting (never trips the leave handler)", () => {
    const { onSelect, buttons } = setup();
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);

    fireEvent.keyDown(buttons[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[2]);

    fireEvent.keyDown(buttons[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[1]);

    fireEvent.keyDown(buttons[1], { key: "End" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);

    fireEvent.keyDown(buttons[buttons.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);

    // The contract that protects the unsaved-changes leave handler:
    // arrow/Home/End move focus only — they must NEVER select a tab.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wraps focus at the ends", () => {
    const { buttons } = setup();
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]); // wrap to last
    fireEvent.keyDown(buttons[buttons.length - 1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[0]); // wrap to first
  });

  it("selects a tab on click (the only path that may fire onSelect)", () => {
    const { onSelect, buttons } = setup();
    fireEvent.click(buttons[2]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("account");
  });

  it("ignores non-navigation keys (Enter/Space do not move roving focus)", () => {
    const { onSelect, buttons } = setup();
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "Enter" });
    fireEvent.keyDown(buttons[0], { key: " " });
    expect(document.activeElement).toBe(buttons[0]); // focus unchanged
    expect(onSelect).not.toHaveBeenCalled(); // keyDown alone doesn't select
  });
});
