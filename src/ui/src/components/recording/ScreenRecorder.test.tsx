import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// Hoisted mock state so the (hoisted) vi.mock factories can read it and each
// test can tweak the recording lifecycle signals before rendering.
const state = vi.hoisted(() => ({
  isYoutubeUrlWorkflowEnabled: true,
  isRecording: false,
  uploadStatus: "idle" as UploadStatus,
}));

vi.mock("../../contexts/AdvancedSettingsContext", () => ({
  useAdvancedSettings: () => ({
    isYoutubeUrlWorkflowEnabled: state.isYoutubeUrlWorkflowEnabled,
  }),
}));

vi.mock("../../contexts/YouTubeAuthContext", () => ({
  useYouTubeAuth: () => ({
    authState: { status: AuthStatus.AUTHENTICATED, userInfo: { name: "Tester" } },
    uploadStatus: state.uploadStatus,
    setUploadResult: vi.fn(),
    setUploadStatus: vi.fn(),
  }),
}));

vi.mock("../../hooks/useScreenRecording", () => ({
  useScreenRecording: () => ({
    isRecording: state.isRecording,
    isProcessing: false,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/hooks/useShaveManager", () => ({
  useShaveManager: () => ({ saveRecording: vi.fn(), checkExistingShave: vi.fn() }),
}));

vi.mock("@/hooks/useWorkflowNavigation", () => ({
  useWorkflowNavigation: () => vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    userSettings: { get: vi.fn().mockResolvedValue({ hotkeys: {}, toolApprovalMode: "ask" }) },
  },
}));

// Child dialogs reach into other electronAPI channels on mount/unmount; they are
// not under test here, so stub them out to keep this test focused on the
// Process-YouTube-link affordance.
vi.mock("./SourcePickerDialog", () => ({ SourcePickerDialog: () => null }));
vi.mock("./VideoPreviewModal", () => ({ VideoPreviewModal: () => null }));

const processYoutubeLink = () => screen.queryByTitle("Process YouTube URL");

describe("ScreenRecorder - Process YouTube link visibility (#775)", () => {
  beforeEach(() => {
    state.isYoutubeUrlWorkflowEnabled = true;
    state.isRecording = false;
    state.uploadStatus = UploadStatus.IDLE;

    // ScreenRecorder subscribes to a few electronAPI event channels on mount.
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      screenRecording: {
        onStopRequest: vi.fn(() => () => {}),
        onOpenSourcePicker: vi.fn(() => () => {}),
        restoreMainWindow: vi.fn(),
        hasAudio: vi.fn(),
      },
      userSettings: { onHotkeyUpdate: vi.fn(() => () => {}) },
    };
  });

  afterEach(() => vi.clearAllMocks());

  it("shows the Process YouTube link before any recording is made (AC2)", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
  });

  it("hides the Process YouTube link once a recording has been made (AC1)", async () => {
    // uploadStatus leaves IDLE the moment a recording is continued, and never
    // returns to IDLE for the session.
    state.uploadStatus = UploadStatus.UPLOADING;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });

  it("hides the Process YouTube link after processing finishes (SUCCESS)", async () => {
    state.uploadStatus = UploadStatus.SUCCESS;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });

  it("hides the Process YouTube link while a recording is in progress", async () => {
    state.isRecording = true;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });

  it("does not show the Process YouTube link when the workflow is disabled", async () => {
    state.isYoutubeUrlWorkflowEnabled = false;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });
});
