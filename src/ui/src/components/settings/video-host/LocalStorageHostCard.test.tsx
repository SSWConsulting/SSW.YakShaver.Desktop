import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus } from "../../../types";
import { LocalStorageHostCard } from "./LocalStorageHostCard";

const state = vi.hoisted(() => ({
  authStatus: "not_authenticated" as AuthStatus,
  getLocalVideoDir: vi.fn(),
  openLocalVideoFolder: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../../contexts/YouTubeAuthContext", () => ({
  useYouTubeAuth: () => ({ authState: { status: state.authStatus } }),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    app: {
      getLocalVideoDir: state.getLocalVideoDir,
      openLocalVideoFolder: state.openLocalVideoFolder,
    },
  },
}));

vi.mock("sonner", () => ({ toast: { error: state.toastError } }));

const ROOT = "C:/Users/me/Videos/YakShaver";

describe("LocalStorageHostCard (#1062)", () => {
  beforeEach(() => {
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    state.getLocalVideoDir.mockReset().mockResolvedValue({ success: true, data: ROOT });
    state.openLocalVideoFolder.mockReset().mockResolvedValue({ success: true });
    state.toastError.mockReset();
  });

  it("is the video host in use when no platform is connected, and shows where files go", async () => {
    render(<LocalStorageHostCard />);

    expect(await screen.findByText(ROOT)).toBeInTheDocument();
    expect(screen.getAllByText("In use").length).toBeGreaterThan(0);
    expect(screen.getByText(/saved on this computer/i)).toBeInTheDocument();
  });

  it("steps back to a fallback once a platform is connected", async () => {
    state.authStatus = AuthStatus.AUTHENTICATED;
    render(<LocalStorageHostCard />);

    expect(await screen.findByText(ROOT)).toBeInTheDocument();
    expect(screen.queryByText("In use")).toBeNull();
    expect(screen.getByText(/used when no video platform is connected/i)).toBeInTheDocument();
  });

  it("opens the recordings folder", async () => {
    const user = userEvent.setup();
    render(<LocalStorageHostCard />);

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    expect(state.openLocalVideoFolder).toHaveBeenCalledWith();
  });

  it("tells the user when the folder can't be opened", async () => {
    state.openLocalVideoFolder.mockResolvedValue({ success: false, error: "Access denied" });
    const user = userEvent.setup();
    render(<LocalStorageHostCard />);

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith("Failed to open folder: Access denied"),
    );
  });
});
