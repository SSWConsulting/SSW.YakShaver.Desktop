import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAMERA_ONLY_SOURCE_ID } from "../constants/recording";
import { useScreenRecording } from "./useScreenRecording";

// Regression coverage for #950: "Cannot stop previous shave when audio
// wasn't opened (stuck state)". Before the fix, stop() silently early-returned
// when no MediaRecorder had ever been created (the state you land in when a
// shave's audio/mic setup never completed) — never resetting isRecording, never
// surfacing an error, leaving the Stop button a permanent no-op.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Minimal fake MediaRecorder that lets tests trigger onstop/onerror and
// inspect stop() calls, so the in-progress branch of stop() (recorder.onstop/
// onerror, the state==='recording' guard, the concurrent-call guard) can be
// exercised the same way a real recording session would reach it — via
// start() — rather than reaching into hook internals.
class FakeMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  stream: MediaStream;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  stop = vi.fn();

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  start() {
    this.state = "recording";
  }
}

// Stubs the browser/electron surface start() needs (MediaRecorder,
// AudioContext, getUserMedia/getDisplayMedia, electronAPI) so a camera-only
// recording session can be driven from start() through to a live
// FakeMediaRecorder instance. Returns a getter for the most recently created
// recorder so tests can drive its onstop/onerror/state directly.
function stubRecordingEnvironment() {
  let lastRecorder: FakeMediaRecorder | undefined;
  const fakeTrack = { stop: vi.fn() };
  const fakeStream = {
    getTracks: () => [fakeTrack],
    getVideoTracks: () => [fakeTrack],
    getAudioTracks: () => [fakeTrack],
  } as unknown as MediaStream;

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    screenRecording: {
      hideControlBar: vi.fn().mockResolvedValue(undefined),
      showControlBar: vi.fn().mockResolvedValue(undefined),
      startTimer: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/rec.mp4" }),
    },
  };

  // vi.fn().mockImplementation(arrowFn) can't be used with `new` (arrow
  // functions aren't constructible), so stub these as plain function
  // constructors instead. jsdom doesn't implement MediaStream/MediaRecorder
  // at all, so both need a global stub for setupRecorder()'s `new
  // MediaStream([...tracks])` call to work.
  vi.stubGlobal("MediaStream", function MockMediaStream(tracks?: unknown[]) {
    const streamTracks = tracks ?? [];
    return {
      getTracks: () => streamTracks,
      getVideoTracks: () => streamTracks,
      getAudioTracks: () => streamTracks,
    };
  } as unknown as typeof MediaStream);

  vi.stubGlobal("MediaRecorder", function MockMediaRecorder(this: unknown, stream: MediaStream) {
    lastRecorder = new FakeMediaRecorder(stream);
    return lastRecorder;
  } as unknown as typeof MediaRecorder);

  vi.stubGlobal("AudioContext", function MockAudioContext() {
    return {
      state: "running",
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createGain: () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
      createMediaStreamDestination: () => ({
        stream: fakeStream,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      destination: {},
      close: vi.fn().mockResolvedValue(undefined),
    };
  } as unknown as typeof AudioContext);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      getDisplayMedia: vi.fn().mockResolvedValue(fakeStream),
    },
  });

  return {
    // Throws instead of returning undefined so callers get a properly
    // narrowed, non-null FakeMediaRecorder without needing `!` assertions
    // (forbidden by this repo's lint config) at every call site.
    getLastRecorder: (): FakeMediaRecorder => {
      if (!lastRecorder) {
        throw new Error("No MediaRecorder was created — did start() run first?");
      }
      return lastRecorder;
    },
  };
}

async function startCameraOnlyRecording(result: {
  current: ReturnType<typeof useScreenRecording>;
}) {
  await act(async () => {
    await result.current.start(CAMERA_ONLY_SOURCE_ID, { cameraDeviceId: "cam-1" });
  });
}

describe("useScreenRecording – stop() when audio/recorder was never opened (#950)", () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      screenRecording: {
        hideControlBar: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/rec.mp4" }),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves (does not hang) and leaves isRecording/isProcessing false when no recorder was ever created", async () => {
    const { result } = renderHook(() => useScreenRecording());

    // No start() was called — mirrors a shave whose audio was never
    // opened/attached, so mediaRecorderRef.current is still null.
    expect(result.current.isRecording).toBe(false);

    let stopResult: unknown;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(stopResult).toBeNull();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it("surfaces a clear, actionable error toast instead of silently no-opping", async () => {
    const { result } = renderHook(() => useScreenRecording());

    await act(async () => {
      await result.current.stop();
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Nothing to stop"));
  });

  it("still resolves cleanly on a second Stop click (does not get stuck)", async () => {
    const { result } = renderHook(() => useScreenRecording());

    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });
});

describe("useScreenRecording – stop() when the recorder went 'inactive' on its own mid-session", () => {
  // A MediaRecorder that was created and started (state 'recording') but
  // transitions to 'inactive' by itself — e.g. its underlying stream/track
  // ended unexpectedly — before the user ever clicks Stop. This is the
  // sibling half of the `!recorder || recorder.state === "inactive"` guard
  // that the never-created ("!recorder") tests above don't exercise: here a
  // recorder *does* exist, it's just already inactive when stop() runs.
  let env: ReturnType<typeof stubRecordingEnvironment>;

  beforeEach(() => {
    env = stubRecordingEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("takes the recovery path (resetToIdle) instead of hanging when the recorder exists but is already 'inactive'", async () => {
    const { result } = renderHook(() => useScreenRecording());

    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    // The recorder went inactive on its own — no stop() was called on it.
    recorder.state = "inactive";

    let stopResult: unknown;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(stopResult).toBeNull();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Nothing to stop"));
    // resetToIdle() must not call recorder.stop() itself (there's nothing to
    // stop) but does tell the backend to stop/clean up its timer.
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(window.electronAPI.screenRecording.stop).toHaveBeenCalledWith(new Uint8Array());
  });

  it("still resets isRecording/isProcessing to false even when a teardown step inside cleanup() throws mid-recovery (#956)", async () => {
    const { result } = renderHook(() => useScreenRecording());

    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    // A teardown step throwing synchronously (e.g. a track whose underlying
    // device was yanked) must not prevent the rest of cleanup()/resetToIdle()
    // from running — otherwise the isRecording/isProcessing resets below it
    // get skipped and the UI is right back to the stuck state this PR fixes.
    recorder.stream.getTracks().forEach((track) => {
      (track as { stop: () => void }).stop = vi.fn(() => {
        throw new Error("device already gone");
      });
    });

    // The recorder went inactive on its own — no stop() was called on it.
    recorder.state = "inactive";

    let stopResult: unknown;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(stopResult).toBeNull();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Nothing to stop"));
  });
});

describe("useScreenRecording – stop() in-progress-recording path (onstop/onerror/re-entrancy)", () => {
  let env: ReturnType<typeof stubRecordingEnvironment>;

  beforeEach(() => {
    env = stubRecordingEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves with the saved recording once onstop fires", async () => {
    const { result } = renderHook(() => useScreenRecording());
    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    recorder.stop.mockImplementation(() => {
      recorder.state = "inactive";
      recorder.onstop?.();
    });

    let stopResult: unknown;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(stopResult).toMatchObject({ filePath: "/tmp/rec.mp4" });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it("settles to null (does not hang) and hides the control bar when onerror fires", async () => {
    const { result } = renderHook(() => useScreenRecording());
    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    recorder.stop.mockImplementation(() => {
      recorder.onerror?.({ error: new DOMException("device lost") });
    });

    let stopResult: unknown;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(stopResult).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Failed to save recording"));
    expect(window.electronAPI.screenRecording.hideControlBar).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it("second concurrent stop() call on a live recorder is a no-op and does not clobber the first call's handlers", async () => {
    const { result } = renderHook(() => useScreenRecording());
    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    // recorder.stop() doesn't fire onstop synchronously here — mirrors a real
    // MediaRecorder, where onstop fires asynchronously after stop() is
    // called. This lets a "concurrent" second stop() call land while the
    // first is still in flight, the exact race the guard exists for.
    recorder.stop.mockImplementation(() => {
      recorder.state = "inactive";
    });

    let first: unknown;
    let second: unknown;
    await act(async () => {
      const p1 = result.current.stop();
      const p2 = result.current.stop();
      // The second call must return immediately (no-op) without touching
      // onstop/onerror, so resolve the first call's recorder now.
      second = await p2;
      recorder.onstop?.();
      first = await p1;
    });

    // The second, concurrent call is a no-op — it must not have overwritten
    // onstop/onerror out from under the first call.
    expect(second).toBeNull();
    expect(first).toMatchObject({ filePath: "/tmp/rec.mp4" });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});

describe("useScreenRecording – stop() STOP_EVENT_TIMEOUT_MS timeout path (#956)", () => {
  let env: ReturnType<typeof stubRecordingEnvironment>;

  beforeEach(() => {
    env = stubRecordingEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("settles to null and resets state after 15s when neither onstop nor onerror ever fires", async () => {
    const { result } = renderHook(() => useScreenRecording());
    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    // Mirrors a real MediaRecorder whose stop() call never results in an
    // onstop/onerror event — e.g. the recording device was revoked, or the
    // browser drops the event — so only the STOP_EVENT_TIMEOUT_MS bound can
    // settle the Promise.
    recorder.stop.mockImplementation(() => {});

    vi.useFakeTimers();

    // stop() sets isProcessing(true) synchronously before its first await,
    // so the call itself (not just the later timer advance) must be wrapped
    // in act(). Track the in-flight promise so the timeout can be advanced
    // and awaited afterwards.
    let stopPromise!: ReturnType<typeof result.current.stop>;
    act(() => {
      stopPromise = result.current.stop();
    });

    // Advance past STOP_EVENT_TIMEOUT_MS (15s) so the timeout guard rejects
    // the stop Promise, then let the resulting state resets flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    const stopResult = await stopPromise;

    expect(stopResult).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Failed to save recording"));
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  }, 15000);

  it("ignores a late onstop firing after the timeout has already settled the promise", async () => {
    const { result } = renderHook(() => useScreenRecording());
    await startCameraOnlyRecording(result);
    const recorder = env.getLastRecorder();

    recorder.stop.mockImplementation(() => {});

    vi.useFakeTimers();

    let stopPromise!: ReturnType<typeof result.current.stop>;
    act(() => {
      stopPromise = result.current.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    const stopResult = await stopPromise;

    // Sanity: the timeout already settled the promise to null, exactly like
    // the test above.
    expect(stopResult).toBeNull();
    const toastSuccessCalls = (toast.success as ReturnType<typeof vi.fn>).mock.calls.length;
    const stopIpcCalls = (window.electronAPI.screenRecording.stop as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // A late-firing onstop after the timeout — e.g. the browser finally
    // delivers the event well after we gave up waiting — must be a no-op: no
    // new Blob built from chunks cleanup() already cleared, no second stop
    // IPC call, and no contradictory success toast on top of the timeout's
    // failure toast. This is only true once recorder.onstop is detached on
    // the timeout settlement path.
    await act(async () => {
      recorder.onstop?.();
      await Promise.resolve();
    });

    expect(window.electronAPI.screenRecording.stop).toHaveBeenCalledTimes(stopIpcCalls);
    expect(toast.success).toHaveBeenCalledTimes(toastSuccessCalls);
  }, 15000);
});
