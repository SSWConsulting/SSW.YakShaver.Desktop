import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("keeps Connect as the available action while disconnected", async () => {
    render(<YouTubeConnection />);
    const user = userEvent.setup();

    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();

    await user.click(connectButton);

    expect(state.startCountdown).toHaveBeenCalledTimes(1);
    expect(state.startAuth).toHaveBeenCalledTimes(1);
  });

  it("shows a connected status and disconnect action after authentication", async () => {
    state.authStatus = AuthStatus.AUTHENTICATED;

    render(<YouTubeConnection />);
    const user = userEvent.setup();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Yak Channel")).toBeInTheDocument();

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    await user.click(disconnectButton);

    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });
});
