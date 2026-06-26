import { describe, expect, it } from "vitest";
import { formatRecordingTime } from "./format-recording-time";

describe("formatRecordingTime", () => {
  it("formats zero as 00:00", () => {
    expect(formatRecordingTime(0)).toBe("00:00");
  });

  it("zero-pads seconds and minutes under an hour", () => {
    expect(formatRecordingTime(1)).toBe("00:01");
    expect(formatRecordingTime(9)).toBe("00:09");
    expect(formatRecordingTime(65)).toBe("01:05");
    expect(formatRecordingTime(599)).toBe("09:59");
  });

  it("switches to HH:MM:SS once past an hour", () => {
    expect(formatRecordingTime(3600)).toBe("01:00:00");
    expect(formatRecordingTime(3661)).toBe("01:01:01");
    expect(formatRecordingTime(36000)).toBe("10:00:00");
  });

  it("clamps non-positive / non-finite input to 00:00", () => {
    expect(formatRecordingTime(-5)).toBe("00:00");
    expect(formatRecordingTime(Number.NaN)).toBe("00:00");
    expect(formatRecordingTime(Number.POSITIVE_INFINITY)).toBe("00:00");
  });

  it("floors fractional seconds", () => {
    expect(formatRecordingTime(1.9)).toBe("00:01");
  });
});
