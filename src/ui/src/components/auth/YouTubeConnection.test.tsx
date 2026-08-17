import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus } from "../../types";
import { YouTubeConnection } from "./YouTubeConnection";

const state = vi.hoisted(() => ({
  authStatus: "not_authenticated" as AuthStatus,
  channelName: "Yak Channel",
  startAuth: vi.fn(),
  disconnect: vi.fn(),
  countdown: 60,
  isConnecting: false,
  startCountdown: vi.fn(),
  resetCountdown: vi.fn(),
}));

vi.mock("../../contexts/YouTubeAuthContext", () => ({
  useYouTubeAuth: () => ({
    authState: {
      status: state.authStatus,
      userInfo:
        state.authStatus === AuthStatus.AUTHENTICATED ? { channelName: state.channelName } : null,
    },
    startAuth: state.startAuth,
    disconnect: state.disconnect,
  }),
}));

vi.mock("../../hooks/useCountdown", () => ({
  useCountdown: () => ({
    countdown: state.countdown,
    isActive: state.isConnecting,
    start: state.startCountdown,
    reset: state.resetCountdown,
  }),
}));

describe("YouTubeConnection", () => {
  beforeEach(() => {
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    state.channelName = "Yak Channel";
    state.countdown = 60;
    state.isConnecting = false;
    state.startAuth.mockReset();
    state.disconnect.mockReset();
    state.startCountdown.mockReset();
    state.resetCountdown.mockReset();
  });

  it("keeps Connect as the primary CTA while disconnected", () => {
    render(<YouTubeConnection />);

    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toBeInTheDocument();
    expect(connectButton.className).toContain("bg-primary");
    expect(screen.queryByRole("status", { name: "Connected" })).not.toBeInTheDocument();
  });

  it("shows a connected status and lower-emphasis Disconnect link after authentication", () => {
    state.authStatus = AuthStatus.AUTHENTICATED;

    render(<YouTubeConnection />);

    expect(screen.getByRole("status", { name: "Connected" })).toBeInTheDocument();
    expect(screen.getByText("Yak Channel")).toBeInTheDocument();

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton.className).toContain("underline");

    const actionArea = disconnectButton.parentElement?.parentElement;
    expect(actionArea?.className).toContain("min-[1140px]:items-end");
  });
});
