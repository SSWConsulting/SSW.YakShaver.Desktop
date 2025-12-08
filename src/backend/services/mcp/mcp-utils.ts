import { homedir } from "node:os";

export class MCPUtils {
  // Expands leading tilde in a path segment to the user's home directory.
  public static expandHomePath(value: string): string {
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
  public static sanitizeSegment(value: string): string {
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
    return MCPUtils.expandHomePath(result);
  }
}
