import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenRecording } from "./useScreenRecording";

// Regression coverage for #950: "Cannot stop previous shave when audio
// wasn't opened (stuck state)". Before the fix, stop() silently early-returned
// when no MediaRecorder had ever been created (the state you land in when a
// shave's audio/mic setup never completed) — never resetting isRecording, never
// surfacing an error, leaving the Stop button a permanent no-op.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

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
