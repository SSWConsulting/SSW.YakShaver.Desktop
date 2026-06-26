import { getDurationParts } from "../../utils/duration-utils";

/**
 * Formats an elapsed recording duration (in whole seconds) as a clock string.
 * Shows `HH:MM:SS` once the recording passes an hour, otherwise `MM:SS`.
 *
 * Pure so the recording timer formatting can be unit-tested without pulling in
 * Electron (see #870). The seconds→parts decomposition is delegated to the
 * shared getDurationParts() helper to keep that arithmetic in one place.
 */
export function formatRecordingTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const { hours, minutes, seconds: secs } = getDurationParts(safe);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
