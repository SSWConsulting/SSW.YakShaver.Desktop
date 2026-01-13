import { homedir } from "node:os";

// Expands leading tilde in a path segment to the user's home directory.
export function expandHomePath(value: string): string {
  if (!value) {
    return value;
  }
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${homedir()}${value.slice(1)}`;
  }
  return value;
}

// Sanitizes a command/argument segment by trimming, removing trailing commas,
// stripping wrapping quotes, and expanding a leading tilde path.
export function sanitizeSegment(value: string): string {
  let result = value.trim();
  if (result.endsWith(",")) {
    result = result.slice(0, -1).trim();
  }
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1).trim();
  }
  return expandHomePath(result);
}
