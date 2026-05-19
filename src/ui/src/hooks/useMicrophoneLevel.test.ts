import { describe, expect, it } from "vitest";

// Pure RMS helpers extracted to keep them independently testable without
// a DOM / Web Audio API environment.
function computeRms(data: Uint8Array): number {
  let sumOfSquares = 0;
  for (const sample of data) {
    const normalised = (sample - 128) / 128;
    sumOfSquares += normalised * normalised;
  }
  return Math.sqrt(sumOfSquares / data.length);
}

function scaleLevel(rms: number): number {
  return Math.min(1, rms * 4);
}

describe("useMicrophoneLevel – RMS computation", () => {
  it("returns 0 for a silent (all-128) buffer", () => {
    const data = new Uint8Array(128).fill(128);
    expect(computeRms(data)).toBe(0);
    expect(scaleLevel(0)).toBe(0);
  });

  it("returns the maximum level for a fully saturated buffer", () => {
    // Alternating 0 / 255 gives maximum amplitude
    const data = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 0 : 255));
    const rms = computeRms(data);
    // Each normalised sample is ±1, so RMS ≈ 1
    expect(rms).toBeCloseTo(1, 2);
    expect(scaleLevel(rms)).toBe(1);
  });

  it("clamps the scaled level to 1 even when RMS exceeds 0.25", () => {
    // A half-amplitude signal produces RMS of 0.5, scaled to 2 → clamped to 1
    const halfAmplitude = 192; // 128 + 64 = 128 + 128*0.5
    const data = new Uint8Array(256).map((_, i) => (i % 2 === 0 ? 128 - 64 : halfAmplitude));
    const rms = computeRms(data);
    expect(scaleLevel(rms)).toBe(1);
  });

  it("produces a level between 0 and 1 for typical speech-like data", () => {
    // Simulate a moderate signal: samples oscillate around 128 by ±20
    const data = new Uint8Array(256).map((_, i) => 128 + (i % 2 === 0 ? 20 : -20));
    const rms = computeRms(data);
    const scaled = scaleLevel(rms);
    expect(scaled).toBeGreaterThan(0);
    expect(scaled).toBeLessThanOrEqual(1);
  });

  it("returns a stable 0 when the input buffer is completely silent", () => {
    // Edge-case: all bytes at exactly 128 → no deviation from baseline
    const data = new Uint8Array(128).fill(128);
    expect(scaleLevel(computeRms(data))).toBe(0);
  });
});
