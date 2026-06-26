/**
 * Pure keyboard-navigation helper for the Settings options list (roving
 * tabindex). Kept dependency-free so it can be unit-tested under the repo's
 * node test environment without a DOM.
 */

/**
 * Given a keyboard key, the currently focused index, and the number of items,
 * return the next index for roving-tabindex navigation, or `null` if the key is
 * not a navigation key (so the caller can ignore it). Wraps around at both ends.
 */
export function nextRovingIndex(key: string, currentIndex: number, length: number): number | null {
  if (length <= 0) {
    return null;
  }

  switch (key) {
    case "ArrowDown":
      return (currentIndex + 1 + length) % length;
    case "ArrowUp":
      return (currentIndex - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
