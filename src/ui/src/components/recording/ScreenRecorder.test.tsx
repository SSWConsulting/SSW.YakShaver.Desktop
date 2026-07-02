import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus, UploadStatus } from "../../types";
import { ScreenRecorder } from "./ScreenRecorder";

// Hoisted mock state so the (hoisted) vi.mock factories can read it and each
// test can tweak the recording lifecycle signals before rendering.
const state = vi.hoisted(() => ({
  isYoutubeUrlWorkflowEnabled: true,
  isRecording: false,
  // Drives the `isDisabled` sub-cause distinct from `isRecording` and
  // `!isAuthenticated` (see the "isDisabled branch" tooltip coverage test
  // below) — mirrors the real useScreenRecording() processing signal.
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
    authState: { status: state.authStatus, userInfo: { name: "Tester" } },
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

// The upload sub-button's title changes depending on why it's disabled (see
// RecordButton's uploadTitle in ScreenRecorder.tsx), so match on the
// invariant "Process YouTube URL" prefix rather than the exact string.
//
// The tooltip `title` lives on the non-disabled wrapper <span>, not on the
// <button> itself — a disabled native <button> never receives hover events
// in a real browser (Chromium's `disabled:pointer-events-none`), so the
// title has to sit on an element that stays interactive (#947 follow-up).
// The <button> keeps a matching `aria-label` for its accessible name and is
// still the element callers need for `toBeDisabled()`/click assertions, so
// resolve from the title-bearing wrapper down to its inner <button>.
const processYoutubeLink = () => {
  const wrapper = screen.queryByTitle(
    /^Process YouTube URL($| \(unavailable (while recording|until you sign in|right now|because only one video per session is supported)\))/,
  );
  return wrapper?.querySelector("button") ?? null;
};
// Reads the hover-tooltip text itself, which lives on the wrapper span (see
// processYoutubeLink above) rather than on the <button>.
const processYoutubeLinkTooltip = () =>
  screen
    .queryByTitle(
      /^Process YouTube URL($| \(unavailable (while recording|until you sign in|right now|because only one video per session is supported)\))/,
    )
    ?.getAttribute("title") ?? null;

describe("ScreenRecorder - Process YouTube link visibility (#775, #946)", () => {
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

  it("shows the Process YouTube link before any recording is made (AC2)", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeEnabled();
  });

  it("disables (but keeps visible) the Process YouTube link once a recording has been made (AC1, #946)", async () => {
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    // Drive the real recording path: stop opens the preview, then continue.
    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    // #946: the control must stay visible (not vanish) once it becomes
    // unavailable — a control that disappears the moment its feature toggle
    // is enabled reads as "missing/broken", not "unavailable right now".
    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(processYoutubeLink()).toBeInTheDocument();
  });

  it("disables (but keeps visible) the Process YouTube link while a recording is in progress (#946)", async () => {
    state.isRecording = true;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeDisabled();
    // #947 follow-up: the isRecording branch has its own tooltip copy,
    // distinct from the isDisabled and post-commit branches — assert it
    // explicitly rather than only checking toBeDisabled().
    expect(processYoutubeLinkTooltip()).toBe("Process YouTube URL (unavailable while recording)");
  });

  it("disables the Process YouTube link with a sign-in-specific title when disabled via !isAuthenticated (#947)", async () => {
    // isDisabled (auth/processing/transcribing) is a distinct disable cause
    // from uploadActionDisabled (recording/video-committed). Drive it via
    // AuthStatus.NOT_AUTHENTICATED (the real enum member — not an ad hoc
    // string) — no recording made, no video committed — so
    // uploadActionDisabled is false and only the !isAuthenticated sub-cause
    // of isDisabled applies. Unlike the transient processing/transcribing
    // sub-causes, signing in requires user action, so it gets its own copy
    // rather than the generic "unavailable right now".
    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeDisabled();
    expect(processYoutubeLinkTooltip()).toBe("Process YouTube URL (unavailable until you sign in)");
  });

  it("disables the Process YouTube link with the generic title when disabled via the plain isDisabled cause (#947)", async () => {
    // isProcessing (a transient app-wide gate distinct from isRecording and
    // !isAuthenticated) is the one isDisabled sub-cause with no dedicated
    // tooltip copy — it falls through to the generic "unavailable right now"
    // message. No recording made, no video committed, authenticated, so
    // uploadActionDisabled is false and only this sub-cause applies.
    state.isProcessing = true;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeDisabled();
    expect(processYoutubeLinkTooltip()).toBe("Process YouTube URL (unavailable right now)");
  });

  it("prioritises the sign-in title over the post-commit title when both disable causes apply (#947)", async () => {
    // Confirms the documented priority order (isRecording > !isAuthenticated
    // > isDisabled > uploadActionDisabled) actually holds when two
    // independent disable causes are true at once: a video was already
    // committed for this session AND the user has since become
    // unauthenticated. !isAuthenticated must win the tooltip text, per the
    // priority chain in RecordButton. `rerender` (same component instance)
    // is used rather than a second `render` so the already-committed video's
    // local state is preserved while the auth context flips.
    const { rerender } = render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));
    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(processYoutubeLinkTooltip()).toBe(
      "Process YouTube URL (unavailable because only one video per session is supported)",
    );

    state.authStatus = AuthStatus.NOT_AUTHENTICATED;
    rerender(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(processYoutubeLinkTooltip()).toBe("Process YouTube URL (unavailable until you sign in)");
  });

  it("gives the post-commit disabled title an accurate, permanent-for-session explanation (#947)", async () => {
    // videoCommitted is never reset once set, so the disabled title must not
    // imply the wait is transient ("until this video finishes processing").
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());

    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(processYoutubeLinkTooltip()).toBe(
      "Process YouTube URL (unavailable because only one video per session is supported)",
    );
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
    // never retry (#775).
    state.uploadStatus = UploadStatus.ERROR;
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(processYoutubeLink()).toBeInTheDocument());
    expect(processYoutubeLink()).toBeEnabled();
  });

  it("disables the Process YouTube link after a successful URL submit", async () => {
    // A submitted URL consumes the same single-video slot as a recording, so
    // the gate must be symmetric: a *successful* URL submit disables the link
    // too, not just a recording (#775 AC2 — only available when multi-video is
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
    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(processYoutubeLink()).toBeInTheDocument();
  });

  it("keeps the primary record button labelled 'Record' after a recording is made", async () => {
    // Regression for the overloaded prop: disabling the upload sub-button
    // after a video is committed must NOT relabel/reshape the primary record
    // button. While the YouTube-URL workflow is enabled the button keeps its
    // split "Record" affordance even after the upload action is disabled
    // (#775 only asked to gate the upload control, not to restyle the record
    // button).
    render(<ScreenRecorder showButtonOnly />);
    await waitFor(() => expect(screen.getByText("Record")).toBeInTheDocument());

    await act(async () => state.stopRequestHandler?.());
    fireEvent.click(await screen.findByTestId("continue-recording"));

    // Upload sub-button is now disabled but still visible, and the record
    // button must still read "Record" (not revert to the single-button
    // "Start Recording" affordance).
    await waitFor(() => expect(processYoutubeLink()).toBeDisabled());
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(screen.queryByText("Start Recording")).not.toBeInTheDocument();
  });
});
