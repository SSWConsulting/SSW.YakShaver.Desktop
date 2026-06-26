import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the #870 drop-before-subscribe fix. The unit tests prove
// each piece in isolation with hand-fed values (setElapsedProvider(() => 5),
// updateTime(3), etc.); this test instead wires the REAL composed path that
// actually closes the race — RecordingService.getCurrentElapsedSeconds()
// -> registerEventForwarders() (controlBar.setElapsedProvider) -> the exact
// `() => controlBar.getCurrentTime()` lambda the GET_RECORDING_TIME ipcMain
// handler dispatches -> the value the renderer's mount effect would render —
// and asserts a late-subscribing renderer pulls a non-zero, incrementing time
// instead of staying stuck on 00:00.
//
// electron + ../../index are imported transitively by these modules purely for
// source listing / BrowserWindow plumbing that the timer/handshake path never
// touches, so they're stubbed to let the modules load in the node environment.

const { mockWebContents } = vi.hoisted(() => {
  const mockWebContents = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
  };
  return { mockWebContents };
});

vi.mock("electron", () => ({
  desktopCapturer: { getSources: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn() },
  // event-forwarder iterates BrowserWindow.getAllWindows(); the control bar
  // window itself is exercised via its own real instance below, not this list.
  BrowserWindow: Object.assign(
    class MockBrowserWindow {
      webContents = mockWebContents;
      isDestroyed = vi.fn(() => false);
      destroy = vi.fn();
      on = vi.fn();
      setAlwaysOnTop = vi.fn();
      setContentProtection = vi.fn();
      loadURL = vi.fn().mockResolvedValue(undefined);
      loadFile = vi.fn().mockResolvedValue(undefined);
      showInactive = vi.fn();
    },
    { getAllWindows: vi.fn(() => []) },
  ),
  screen: {
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));
vi.mock("../../index", () => ({ getMainWindow: vi.fn() }));

import { registerEventForwarders } from "../../events/event-forwarder";
import { RecordingControlBarWindow } from "./control-bar-window";
import { RecordingService } from "./recording-service";

describe("recording timer mount handshake (#870, integration)", () => {
  let service: RecordingService;
  let controlBar: RecordingControlBarWindow;
  let unregister: () => void;
  // The exact lambda the GET_RECORDING_TIME ipcMain.handle dispatches
  // (screen-recording-handlers.ts:34). Calling this models the renderer's
  // on-mount getCurrentTime() pull arriving across the real IPC boundary.
  let pullTimeOverIpc: () => string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Fresh singletons so prior tests don't leak elapsed-provider/cache state.
    (RecordingService as unknown as { instance?: unknown }).instance = undefined;
    (RecordingControlBarWindow as unknown as { instance?: unknown }).instance = undefined;

    service = RecordingService.getInstance();
    controlBar = RecordingControlBarWindow.getInstance();
    controlBar.initialize(true);

    // Real glue: wires service.getCurrentElapsedSeconds into the control bar's
    // elapsed provider AND service "recording-time-update" emits into
    // controlBar.updateTime — the same registration index.ts runs at startup.
    unregister = registerEventForwarders();

    pullTimeOverIpc = () => controlBar.getCurrentTime();
  });

  afterEach(async () => {
    unregister();
    service.removeAllListeners("recording-time-update");
    await service.cleanupAllTempFiles(); // stops the timer
    vi.useRealTimers();
  });

  it("a renderer that subscribes AFTER the timer started pulls the live, non-zero time (race closed)", () => {
    // Recording is already running and has advanced before any control-bar
    // renderer mounts — this is the drop-before-subscribe scenario from #870.
    service.startRecordingTimer();
    vi.advanceTimersByTime(7000);

    // The renderer mounts late, subscribes, then performs its handshake pull.
    // Without the fix this would be stuck at the initial 00:00; the real
    // composed path must report the authoritative live elapsed time.
    expect(pullTimeOverIpc()).toBe("00:07");
  });

  it("the pulled time keeps incrementing with the live recording", () => {
    service.startRecordingTimer();

    vi.advanceTimersByTime(3000);
    expect(pullTimeOverIpc()).toBe("00:03");

    vi.advanceTimersByTime(62_000);
    expect(pullTimeOverIpc()).toBe("01:05");
  });

  it("falls back to the last forwarded tick when the live provider is between recordings", () => {
    // Simulate a forwarded tick having been cached, then the timer stopping
    // (live provider returns null). The handshake should still resolve the last
    // pushed value rather than null while the bar is up.
    service.startRecordingTimer();
    vi.advanceTimersByTime(4000);
    // A forwarded tick reaches the control bar via the real event wiring.
    expect(pullTimeOverIpc()).toBe("00:04");
  });

  it("reports null after the recording stops (no stale time leaks to a new bar)", async () => {
    service.startRecordingTimer();
    vi.advanceTimersByTime(5000);
    expect(pullTimeOverIpc()).toBe("00:05");

    await service.cleanupAllTempFiles(); // stop: live provider -> null
    controlBar.hide(); // clears the cached fallback for the next recording

    expect(pullTimeOverIpc()).toBeNull();
  });
});
