import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection";

describe("SettingsSection", () => {
  it("renders the title, description and children", () => {
    render(
      <SettingsSection title="Key Mapping" description="Set the global shortcut.">
        <button type="button">Save</button>
      </SettingsSection>,
    );
    expect(screen.getByText("Key Mapping")).toBeInTheDocument();
    expect(screen.getByText("Set the global shortcut.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("omits the description when none is given", () => {
    render(
      <SettingsSection title="Launch at Login">
        <span>content</span>
      </SettingsSection>,
    );
    expect(screen.getByText("Launch at Login")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("applies a custom content class so row/grid layouts are preserved", () => {
    render(
      <SettingsSection title="Launch at Login" contentClassName="flex items-center justify-between">
        <span>child</span>
      </SettingsSection>,
    );
    const child = screen.getByText("child");
    // The content wrapper is the child's parent; it should carry the custom class.
    expect(child.parentElement?.className).toContain("justify-between");
  });

  it("renders as a lightweight divider, not an elevated Card (#872 AC2)", () => {
    render(
      <SettingsSection title="Key Mapping">
        <span>content</span>
      </SettingsSection>,
    );
    const section = screen.getByText("content").closest("section");
    expect(section).not.toBeNull();
    // No card surface (background/shadow/rounded) — just a bottom-border divider.
    expect(section?.className).toContain("border-b");
    expect(section?.className).not.toContain("shadow");
    expect(section?.className).not.toContain("bg-card");
  });
});
