import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseBehaviorSetting } from "./CloseBehaviorSetting";

const { get, update } = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    userSettings: {
      get,
      update,
    },
  },
}));

describe("CloseBehaviorSetting (#576)", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({
      toolApprovalMode: "ask",
      openAtLogin: false,
      hotkeys: { startRecording: "PrintScreen" },
      closeBehavior: "minimize-to-tray",
    });
    update.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders both On Close options", async () => {
    render(<CloseBehaviorSetting isActive={true} />);

    expect(await screen.findByText("On Close")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimize to tray/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /quit application/i })).toBeInTheDocument();
  });

  it("marks the persisted preference as selected on load (AC: persists across restarts)", async () => {
    get.mockResolvedValue({
      toolApprovalMode: "ask",
      openAtLogin: false,
      hotkeys: { startRecording: "PrintScreen" },
      closeBehavior: "quit",
    });

    render(<CloseBehaviorSetting isActive={true} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /quit application/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: /minimize to tray/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("persists the selection when the user picks Quit application (AC: setting exists with two options)", async () => {
    render(<CloseBehaviorSetting isActive={true} />);
    await screen.findByText("On Close");

    await userEvent.click(screen.getByRole("button", { name: /quit application/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ closeBehavior: "quit" });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /quit application/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("shows an error toast and keeps the previous selection when the update fails", async () => {
    update.mockResolvedValue({ success: false, error: "boom" });

    render(<CloseBehaviorSetting isActive={true} />);
    await screen.findByText("On Close");

    await userEvent.click(screen.getByRole("button", { name: /quit application/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ closeBehavior: "quit" });
    });
    expect(screen.getByRole("button", { name: /minimize to tray/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not load settings when inactive", () => {
    render(<CloseBehaviorSetting isActive={false} />);
    expect(get).not.toHaveBeenCalled();
  });
});
