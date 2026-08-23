import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("Enter/Space keyDown does not move roving focus", () => {
    // This only proves Enter/Space keyDown don't MOVE the roving focus. It does
    // NOT prove the activation contract — that Enter/Space SELECT is covered by
    // the user-event activation test below (fireEvent.keyDown can't synthesize the
    // native button click that activation relies on, so a not-selected assertion
    // here would pass for the wrong reason).
    const { buttons } = setup();
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "Enter" });
    fireEvent.keyDown(buttons[0], { key: " " });
    expect(document.activeElement).toBe(buttons[0]); // focus unchanged
  });

  it("selects the focused tab on Enter and on Space (native button activation)", async () => {
    const user = userEvent.setup();
    const { onSelect, buttons } = setup();

    buttons[1].focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith("videoHost");

    buttons[2].focus();
    await user.keyboard(" "); // Space activates a button on keyup
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("account");
  });

  it("roving target follows actual focus after a vetoed change, not the stale active tab", () => {
    // activeTabId stays "general" (index 0) — as if a tab change was vetoed by the
    // unsaved-changes guard so the activeIndex resync effect never fires — but focus
    // has landed on a non-active tab. A later Arrow must step from where focus is.
    const { buttons } = setup("general");
    act(() => buttons[2].focus()); // focus lands on "account" (a non-active tab)
    expect(document.activeElement).toBe(buttons[2]);
    // onFocus moved the roving target to the focused tab (confirms the resync flushed).
    expect(buttons[2]).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(buttons[2], { key: "ArrowDown" });
    // steps from the visibly-focused tab (account -> release), NOT from activeIndex
    // (which would have gone general -> videoHost).
    expect(document.activeElement).toBe(buttons[3]);
  });

  it("moves the roving tabindex to the active tab when activeTabId changes", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SettingsNav tabs={tabs} activeTabId="general" onSelect={onSelect} />,
    );
    let buttons = screen.getAllByRole("tab");
    expect(buttons[0]).toHaveAttribute("tabindex", "0"); // general is the roving target
    expect(buttons[2]).toHaveAttribute("tabindex", "-1");

    rerender(<SettingsNav tabs={tabs} activeTabId="account" onSelect={onSelect} />);
    buttons = screen.getAllByRole("tab");
    expect(buttons[2]).toHaveAttribute("tabindex", "0"); // resynced to the new active tab
    expect(buttons[0]).toHaveAttribute("tabindex", "-1");
  });
});

describe("SettingsNav (#785) scrollable when window height is reduced", () => {
  it("renders the tablist inside a scroll-area viewport, not a plain overflow div", () => {
    // #785: the nav previously scrolled via a bare `overflow-y-auto` div, whose
    // scrollbar is the OS/browser's native one — which can render with zero
    // visible width (observed on Linux/GTK themes) or stay hidden until
    // scrolled (macOS default), leaving no visible affordance that more tabs
    // exist below the fold. The tablist must live inside the shared
    // `ScrollArea` (the same styled-scrollbar component the settings panel
    // uses) so it gets a visible, cross-OS-consistent scrollbar whenever its
    // content overflows.
    render(<SettingsNav tabs={tabs} activeTabId="general" onSelect={vi.fn()} />);

    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    const viewport = tablist.closest('[data-slot="scroll-area-viewport"]');
    expect(viewport).not.toBeNull();

    const scrollAreaRoot = viewport?.closest('[data-slot="scroll-area"]');
    expect(scrollAreaRoot).not.toBeNull();
  });
});
