import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// Regression for the 360-mode Record-button deadlock: selectedProjectId is
// only ever set from inside Cloud360ProjectDialog.onConfirm, and that dialog
// is only opened by clicking Record. Gating Record on selectedProjectId made
// the button (and therefore the dialog) permanently unreachable.
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
    // 360 mode + signed in, but the project dialog has not run yet, so no
    // project has been chosen — this is exactly the deadlock scenario.
    llm: { getConfig: vi.fn().mockResolvedValue({ orchestrationBackend: "cloud-360" }) },
    auth: { identityServer: { status: vi.fn().mockResolvedValue({ status: "authenticated" }) } },
  },
}));

vi.mock("./SourcePickerDialog", () => ({ SourcePickerDialog: () => null }));

vi.mock("../cloud360/Cloud360ProjectDialog", () => ({
  Cloud360ProjectDialog: () => null,
}));

vi.mock("./VideoPreviewModal", () => ({
  VideoPreviewModal: () => null,
}));

beforeEach(() => {
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
});

describe("ScreenRecorder - 360 mode Record button (deadlock regression)", () => {
  it("keeps Record enabled while signed in even though no project is selected yet", async () => {
    render(<ScreenRecorder showButtonOnly />);

    const recordButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /Start Recording/i });
      expect(button).toBeInTheDocument();
      return button;
    });

    // The button must be clickable so the project dialog can ever open —
    // selectedProjectId is only ever set from inside that dialog.
    expect(recordButton).not.toBeDisabled();
  });
});
