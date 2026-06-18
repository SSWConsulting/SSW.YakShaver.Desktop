/**
 * Formats an elapsed recording duration (in whole seconds) as a clock string.
 * Shows `HH:MM:SS` once the recording passes an hour, otherwise `MM:SS`.
 *
 * Pure + dependency-free so the recording timer formatting can be unit-tested
 * without pulling in Electron (see #870).
 */
export function formatRecordingTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}
