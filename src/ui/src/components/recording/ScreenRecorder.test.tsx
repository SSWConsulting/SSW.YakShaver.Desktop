import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// Hoisted mock state so the (hoisted) vi.mock factories can read it and each
// test can tweak the recording lifecycle signals before rendering.
const state = vi.hoisted(() => ({
  isYoutubeUrlWorkflowEnabled: true,
  isRecording: false,
  // Drives the `isDisabled` sub-cause distinct from `isRecording` and
  // the video-host auth gate (see the "isDisabled branch" tooltip coverage
  // test below) — mirrors the real useScreenRecording() processing signal.
  isProcessing: false,
  authStatus: "authenticated" as string,
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
    authState: {
      status: state.authStatus,
      userInfo: state.authStatus === AuthStatus.AUTHENTICATED ? { name: "Tester" } : null,
    },
    uploadStatus: state.uploadStatus,
    setUploadResult: vi.fn(),
    setUploadStatus: vi.fn(),
  }),
}));

vi.mock("../../hooks/useScreenRecording", () => ({
  useScreenRecording: () => ({
    isRecording: state.isRecording,
    isProcessing: state.isProcessing,
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
  },
}));

// Stub SourcePickerDialog; it reaches into electronAPI channels not under test.
vi.mock("./SourcePickerDialog", () => ({ SourcePickerDialog: () => null }));

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
    useEffect(() => {
      // The real modal loads duration before Continue can run.
      onDurationLoad(42);
    }, [onDurationLoad]);

    return (
      <button type="button" data-testid="continue-recording" onClick={() => onContinue(false)}>
        Continue
      </button>
    );
  },
}));

// The upload sub-button's title changes depending on why it's disabled (see
// RecordButton's uploadTitle in ScreenRecorder.tsx), so match on the
// invariant "Process YouTube URL" prefix rather than the exact string.
//
// The tooltip `title` lives on the wrapper, while the <button> keeps a short
// accessible name plus aria-describedby for the unavailable-state explanation.
const processYoutubeLink = () => {
  const wrapper = screen.queryByTitle(
    /^Process YouTube URL($| \(unavailable (while recording|until a video host is connected|right now)\))/,
  );
  return wrapper?.querySelector("button") ?? null;
};
// Reads the hover-tooltip text itself, which lives on the wrapper span (see
// processYoutubeLink above) rather than on the <button>.
const processYoutubeLinkTooltip = () =>
  screen
    .queryByTitle(
      /^Process YouTube URL($| \(unavailable (while recording|until a video host is connected|right now)\))/,
    )
    ?.getAttribute("title") ?? null;
const processYoutubeLinkDescription = () => {
  const button = processYoutubeLink();
  const descriptionId = button?.getAttribute("aria-describedby");
  return descriptionId ? document.getElementById(descriptionId)?.textContent : null;
};
const expectProcessYoutubeLinkUnavailable = (title: string) => {
  const button = processYoutubeLink();

  expect(button).toBeEnabled();
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).toHaveAccessibleName("Process YouTube URL");
  expect(processYoutubeLinkTooltip()).toBe(title);
  expect(processYoutubeLinkDescription()).toBe(title);
};

describe("ScreenRecorder - Process YouTube link visibility (#946)", () => {
  beforeEach(() => {
    state.isYoutubeUrlWorkflowEnabled = true;
    state.isRecording = false;
    state.isProcessing = false;
    state.authStatus = AuthStatus.AUTHENTICATED;
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

  it("shows the Process YouTube link before any recording is made", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeEnabled();
  });

  it("keeps the Process YouTube link enabled once a recording has been submitted", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    // Drive the real recording path: stop opens the preview, then continue.
    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    // Processing a submitted recording does not block starting another
    // recording, so the URL entry point follows the same concurrency rule.
    await waitFor(() => expect(window.electronAPI.pipelines.processVideoFile).toHaveBeenCalled());
    await waitFor(() => expect(processYoutubeLink()).toBeEnabled());
    expect(processYoutubeLink()).toBeInTheDocument();
  });

  it("hides the Process YouTube link and keeps Stop Recording available while recording", async () => {
    state.isRecording = true;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Stop Recording/i })).toBeEnabled();
  });

  it("disables the Process YouTube link with a video-host-specific title when no host is connected (#947)", async () => {
    // The video-host auth gate is a distinct shared disable cause from
    // active recording. Drive it via
    // AuthStatus.NOT_AUTHENTICATED (the real enum member — not an ad hoc
    // string) — no recording in progress — so
    // no recording in progress, so only the video-host auth sub-cause applies.
    // Unlike transient processing/transcribing, connecting a video host
    // requires user action, so it gets its own copy rather than the generic
    // "unavailable right now".
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expectProcessYoutubeLinkUnavailable(
      "Process YouTube URL (unavailable until a video host is connected)",
    );
  });

  it("disables the Process YouTube link with the generic title when disabled via the plain isDisabled cause (#947)", async () => {
    // isProcessing (a transient app-wide gate distinct from isRecording and
    // video-host auth) is the one isDisabled sub-cause with no dedicated
    // tooltip copy — it falls through to the generic "unavailable right now"
    // message. No recording in progress, authenticated, so
    // active recording is false and only this sub-cause applies.
    state.isProcessing = true;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expectProcessYoutubeLinkUnavailable("Process YouTube URL (unavailable right now)");
  });

  it("hides the Process YouTube link while recording even if the video host disconnects", async () => {
    state.isRecording = true;
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Stop Recording/i })).toBeEnabled();
  });

  it("keeps the unavailable Process YouTube link focusable but blocks activation", async () => {
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    const button = processYoutubeLink();

    expectProcessYoutubeLinkUnavailable(
      "Process YouTube URL (unavailable until a video host is connected)",
    );
    fireEvent.click(button as HTMLElement);

    expect(screen.queryByLabelText("YouTube URL")).not.toBeInTheDocument();
  });

  it("disables an already-open YouTube URL submit when upload becomes unavailable", async () => {
    const { rerender } = render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    fireEvent.click(processYoutubeLink() as HTMLElement);
    const input = await screen.findByLabelText("YouTube URL");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    state.isRecording = true;
    rerender(<ScreenRecorder showButtonOnly />);

    const submitButton = screen.getByRole("button", { name: "Process Link" });
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);

    expect(window.electronAPI.pipelines.processVideoUrl).not.toHaveBeenCalled();
    expect(screen.getByLabelText("YouTube URL")).toBeInTheDocument();
  });

  it("does not show the Process YouTube link when the workflow is disabled", async () => {
    state.isYoutubeUrlWorkflowEnabled = false;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).not.toBeInTheDocument());
  });

  it("keeps the Process YouTube link enabled after a URL submit fails on a fresh session", async () => {
    // Regression for the one-way latch: a failed Process-YouTube-URL submit
    // drives session-global uploadStatus to ERROR. The affordance must NOT be
    // gated on that signal, otherwise the upload button — the only entry point
    // to the URL dialog — would become permanently unusable and the user could
    // never retry.
    state.uploadStatus = UploadStatus.ERROR;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeEnabled();
  });

  it("keeps the Process YouTube link enabled after a successful URL submit", async () => {
    // A submitted URL starts background processing, but background processing
    // does not block starting another recording. Keep the URL entry point
    // symmetric with the recording button and allow another submission.
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
    await waitFor(() => expect(processYoutubeLink()).toBeEnabled());
    expect(processYoutubeLink()).toBeInTheDocument();
  });

  it("keeps the Process YouTube link enabled while a URL submit is still pending", async () => {
    let resolveProcessVideoUrl: (() => void) | undefined;
    window.electronAPI.pipelines.processVideoUrl = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveProcessVideoUrl = resolve;
        }),
    );

    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    fireEvent.click(processYoutubeLink() as HTMLElement);
    const input = await screen.findByLabelText("YouTube URL");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Process Link" }));
    });

    await waitFor(() => expect(window.electronAPI.pipelines.processVideoUrl).toHaveBeenCalled());
    await waitFor(() => expect(processYoutubeLink()).toBeEnabled());
    fireEvent.click(processYoutubeLink() as HTMLElement);
    expect(screen.getByLabelText("YouTube URL")).toBeInTheDocument();

    await act(async () => resolveProcessVideoUrl?.());
  });

  it("keeps the primary record button labelled 'Record' after a recording is made", async () => {
    // Regression for the overloaded prop: submitting a recording must NOT
    // relabel/reshape the primary record button. While the YouTube-URL
    // workflow is enabled the button keeps its split "Record" affordance.
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(screen.getByText("Record")).toBeInTheDocument());

    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    // Upload sub-button is still visible and enabled, and the record button
    // must still read "Record" (not revert to the single-button
    // "Start Recording" affordance).
    await waitFor(() => expect(processYoutubeLink()).toBeEnabled());
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(screen.queryByText("Start Recording")).not.toBeInTheDocument();
  });
});
