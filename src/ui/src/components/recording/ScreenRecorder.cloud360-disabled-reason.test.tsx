import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// #1023 review — regression for the 360-mode disabled-reason mismatch: the record
// button's tooltip/aria-describedby reason was derived only from the standard-flow
// video-host auth, ignoring is360Mode entirely. A 360-mode user who isn't signed in
// to Identity Server was shown "Recording requires a connected video host." — a
// factually wrong, actionable-looking message, since 360 mode has no such concept.
vi.mock("../../contexts/AdvancedSettingsContext", () => ({
  useAdvancedSettings: () => ({ isYoutubeUrlWorkflowEnabled: false }),
}));

vi.mock("../../contexts/YouTubeAuthContext", () => ({
  useYouTubeAuth: () => ({
    authState: { status: AuthStatus.NOT_AUTHENTICATED, userInfo: null },
    uploadStatus: UploadStatus.IDLE,
    setUploadResult: vi.fn(),
    setUploadStatus: vi.fn(),
  }),
}));

vi.mock("../../hooks/useScreenRecording", () => ({
  useScreenRecording: () => ({
    isRecording: false,
    isProcessing: false,
    start: vi.fn(),
    stop: vi.fn(async () => null),
  }),
}));

vi.mock("@/hooks/useShaveManager", () => ({
  useShaveManager: () => ({
    saveRecording: vi.fn(),
    checkExistingShave: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWorkflowNavigation", () => ({
  useWorkflowNavigation: () => vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    userSettings: { get: vi.fn().mockResolvedValue({ hotkeys: {}, toolApprovalMode: "ask" }) },
    // 360 mode, but NOT signed in to Identity Server — the case the disabled-reason
    // fix needs to describe accurately instead of the standard video-host copy.
    llm: { getConfig: vi.fn().mockResolvedValue({ orchestrationBackend: "cloud-360" }) },
    auth: { identityServer: { status: vi.fn().mockResolvedValue({ status: "unauthenticated" }) } },
  },
}));

vi.mock("./SourcePickerDialog", () => ({ SourcePickerDialog: () => null }));

vi.mock("../cloud360/Cloud360ProjectDialog", () => ({
  Cloud360ProjectDialog: () => null,
}));

vi.mock("./VideoPreviewModal", () => ({
  VideoPreviewModal: () => null,
}));

function setupElectronApi() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    screenRecording: {
      onStopRequest: vi.fn(() => () => {}),
      onOpenSourcePicker: vi.fn(() => () => {}),
      restoreMainWindow: vi.fn(),
      hasAudio: vi.fn().mockResolvedValue({ success: true, hasAudio: true }),
    },
    pipelines: {
      processVideoFile: vi.fn().mockResolvedValue(undefined),
      processVideoUrl: vi.fn().mockResolvedValue(undefined),
    },
    userSettings: { onHotkeyUpdate: vi.fn(() => () => {}) },
  };
}

describe("ScreenRecorder - 360 mode disabled-reason accuracy (#1023 review)", () => {
  it("does not show the standard video-host reason when disabled in 360 mode", async () => {
    setupElectronApi();
    render(<ScreenRecorder showButtonOnly />);

    const button = await waitFor(() => {
      const el = screen.getByRole("button", { name: "Start Recording" });
      expect(el).toBeDisabled();
      return el;
    });

    const wrapper = button.parentElement;
    expect(wrapper).not.toHaveAttribute("title", "Recording requires a connected video host.");

    const descriptionId = button.getAttribute("aria-describedby");
    if (descriptionId) {
      expect(document.getElementById(descriptionId)?.textContent).not.toBe(
        "Recording requires a connected video host.",
      );
    }
  });

  it("shows the Identity Server-specific reason when disabled in 360 mode", async () => {
    setupElectronApi();
    render(<ScreenRecorder showButtonOnly />);

    const button = await waitFor(() => {
      const el = screen.getByRole("button", { name: "Start Recording" });
      expect(el).toBeDisabled();
      return el;
    });

    const wrapper = button.parentElement;
    expect(wrapper).toHaveAttribute("title", "Recording requires signing in to Identity Server.");

    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId as string)?.textContent).toBe(
      "Recording requires signing in to Identity Server.",
    );
  });

  it("does not show the standard video-host Badge/banner in 360 mode", async () => {
    setupElectronApi();
    render(<ScreenRecorder showButtonOnly />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Recording" })).toBeDisabled();
    });

    expect(screen.queryByTestId("video-host-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
