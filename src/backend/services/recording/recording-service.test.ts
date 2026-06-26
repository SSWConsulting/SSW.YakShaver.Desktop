import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// recording-service.ts imports electron + ../../index purely for source listing;
// none of that is exercised by the timer path, so stub them so the module loads
// in the node test environment.
vi.mock("electron", () => ({
  desktopCapturer: { getSources: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn() },
}));
vi.mock("../../index", () => ({ getMainWindow: vi.fn() }));

import { RecordingService } from "./recording-service";

describe("RecordingService timer (#870)", () => {
  let service: RecordingService;
  let ticks: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    service = RecordingService.getInstance();
    ticks = [];
    service.on("recording-time-update", (t: number) => ticks.push(t));
  });

  afterEach(async () => {
    service.removeAllListeners("recording-time-update");
    await service.cleanupAllTempFiles(); // stops the timer
    vi.useRealTimers();
  });

  it("emits 0 immediately so the control bar shows a value at t=0", () => {
    service.startRecordingTimer();
    expect(ticks).toEqual([0]);
  });

  it("increments once per second after the immediate 0", () => {
    service.startRecordingTimer();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([0, 1, 2, 3]);
  });

  it("stops emitting once the recording is stopped/cleaned up", async () => {
    service.startRecordingTimer();
    vi.advanceTimersByTime(2000);
    expect(ticks).toEqual([0, 1, 2]);

    await service.cleanupAllTempFiles();
    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([0, 1, 2]); // no further ticks after stop
  });

  it("reports live elapsed seconds while running and null when stopped (#870 handshake)", async () => {
    expect(service.getCurrentElapsedSeconds()).toBeNull();

    service.startRecordingTimer();
    expect(service.getCurrentElapsedSeconds()).toBe(0);

    vi.advanceTimersByTime(3000);
    expect(service.getCurrentElapsedSeconds()).toBe(3);

    await service.cleanupAllTempFiles();
    expect(service.getCurrentElapsedSeconds()).toBeNull();
  });

  it("restarts cleanly from 0 on a subsequent recording", async () => {
    service.startRecordingTimer();
    vi.advanceTimersByTime(2000);
    await service.cleanupAllTempFiles(); // stop the first recording
    vi.advanceTimersByTime(2000); // stopped: no ticks

    service.startRecordingTimer(); // second recording re-emits an immediate 0
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([0, 1, 2, 0, 1]);
  });
});
