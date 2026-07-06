import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// Hoisted mock state so the (hoisted) vi.mock factories can read it and each
// test can tweak the recording lifecycle signals before rendering.
const state = vi.hoisted(() => ({
  isYoutubeUrlWorkflowEnabled: true,
  isRecording: false,
  uploadStatus: "idle" as UploadStatus,
  // The recorded video returned by stop(); when set, "Continue" drives the
  // real handleContinue path that marks a recording as made.
  recordedVideo: null as { blob: Blob; filePath: string; fileName: string } | null,
  saveRecording: vi.fn(),
  checkExistingShave: vi.fn(),
  // Captured handler the app registers on the screen-recording stop channel;
  // invoking it drives the real handleStopRecording -> preview flow.
  stopRequestHandler: null as ((...args: unknown[]) => void) | null,
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
    stop: vi.fn(async () => state.recordedVideo),
  }),
}));

vi.mock("@/hooks/useShaveManager", () => ({
  useShaveManager: () => ({
    saveRecording: state.saveRecording,
    checkExistingShave: state.checkExistingShave,
  }),
}));

vi.mock("@/hooks/useWorkflowNavigation", () => ({
  useWorkflowNavigation: () => vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    userSettings: { get: vi.fn().mockResolvedValue({ hotkeys: {}, toolApprovalMode: "ask" }) },
    // Non-360 / unauthenticated stubs: this suite covers the existing local
    // recording flow, which must remain unaffected by cloud-360 mode.
    llm: { getConfig: vi.fn().mockResolvedValue({ orchestrationBackend: "openai" }) },
    auth: { identityServer: { status: vi.fn().mockResolvedValue({ status: "unauthenticated" }) } },
  },
}));

// Stub SourcePickerDialog; it reaches into electronAPI channels not under test.
vi.mock("./SourcePickerDialog", () => ({ SourcePickerDialog: () => null }));

// Stub the 360 project dialog; this suite covers the non-360 default path.
vi.mock("../cloud360/Cloud360ProjectDialog", () => ({
  Cloud360ProjectDialog: () => null,
}));

// Surface the preview modal's onContinue as a button so tests can drive the
// real "a recording was made" path without a full media-capture pipeline.
vi.mock("./VideoPreviewModal", () => ({
  VideoPreviewModal: ({
    onContinue,
    onDurationLoad,
  }: {
    onContinue: (auto: boolean) => void;
    onDurationLoad: (duration: number) => void;
  }) => {
    // The real modal loads the duration before Continue is enabled; mirror that
    // so handleContinue does not bail on its duration guard.
    onDurationLoad(42);
    return (
      <button type="button" data-testid="continue-recording" onClick={() => onContinue(false)}>
        Continue
      </button>
    );
  },
}));

const processYoutubeLink = () => screen.queryByTitle("Process YouTube URL");

describe("ScreenRecorder - Process YouTube link visibility (#775)", () => {
  beforeEach(() => {
    state.isYoutubeUrlWorkflowEnabled = true;
    state.isRecording = false;
    state.uploadStatus = UploadStatus.IDLE;
    state.recordedVideo = { blob: new Blob(), filePath: "/tmp/rec.webm", fileName: "rec.webm" };
    state.saveRecording = vi.fn().mockResolvedValue({ data: { id: "shave-1" } });
    state.checkExistingShave = vi.fn().mockResolvedValue(undefined);

    // ScreenRecorder subscribes to a few electronAPI event channels on mount.
    state.stopRequestHandler = null;
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      screenRecording: {
        onStopRequest: vi.fn((cb: (...args: unknown[]) => void) => {
          state.stopRequestHandler = cb;
          return () => {};
        }),
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

  afterEach(() => vi.clearAllMocks());

  it("shows the Process YouTube link before any recording is made (AC2)", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
  });

  it("hides the Process YouTube link once a recording has been made (AC1)", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    // Drive the real recording path: stop opens the preview, then continue.
    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

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

  it("keeps the Process YouTube link after a URL submit fails on a fresh session", async () => {
    // Regression for the one-way latch: a failed Process-YouTube-URL submit
    // drives session-global uploadStatus to ERROR. The affordance must NOT be
    // gated on that signal, otherwise the upload button — the only entry point
    // to the URL dialog — would vanish and the user could never retry (#775).
    state.uploadStatus = UploadStatus.ERROR;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
  });

  it("hides the Process YouTube link after a successful URL submit", async () => {
    // A submitted URL consumes the same single-video slot as a recording, so
    // the gate must be symmetric: a *successful* URL submit hides the link too,
    // not just a recording (#775 AC2 — only available when multi-video is
    // supported). The recording path is covered above; this covers the URL
    // branch that previously left the gate open.
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    // Open the URL dialog (the upload sub-button is its only entry point),
    // enter a valid URL, and submit it through the real handleProcessYoutubeUrl.
    fireEvent.click(processYoutubeLink() as HTMLElement);
    const input = await screen.findByLabelText("YouTube URL");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Process Link" }));
    });

    await waitFor(() => expect(window.electronAPI.pipelines.processVideoUrl).toHaveBeenCalled());
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });

  it("keeps the primary record button labelled 'Record' after a recording is made", async () => {
    // Regression for the overloaded prop: hiding the upload sub-button after a
    // video is committed must NOT relabel/reshape the primary record button.
    // While the YouTube-URL workflow is enabled the button keeps its split
    // "Record" affordance even after the upload action is hidden (#775 only
    // asked to hide the upload control, not to restyle the record button).
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(screen.getByText("Record")).toBeInTheDocument());

    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    // Upload sub-button is gone, but the record button must still read "Record"
    // (not revert to the single-button "Start Recording" affordance).
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(screen.queryByText("Start Recording")).not.toBeInTheDocument();
  });
});
