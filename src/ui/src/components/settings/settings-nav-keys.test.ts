import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "./settings-nav-keys";

// 8 tabs, mirroring the real Settings nav (General … Releases).
const LEN = 8;

describe("nextRovingIndex", () => {
  it("ArrowDown moves to the next item", () => {
    expect(nextRovingIndex("ArrowDown", 0, LEN)).toBe(1);
    expect(nextRovingIndex("ArrowDown", 6, LEN)).toBe(7);
  });

  it("ArrowDown wraps from the last item to the first", () => {
    expect(nextRovingIndex("ArrowDown", LEN - 1, LEN)).toBe(0);
  });

  it("ArrowUp moves to the previous item", () => {
    expect(nextRovingIndex("ArrowUp", 7, LEN)).toBe(6);
    expect(nextRovingIndex("ArrowUp", 1, LEN)).toBe(0);
  });

  it("ArrowUp wraps from the first item to the last", () => {
    expect(nextRovingIndex("ArrowUp", 0, LEN)).toBe(LEN - 1);
  });

  it("Home jumps to the first item and End to the last", () => {
    expect(nextRovingIndex("Home", 5, LEN)).toBe(0);
    expect(nextRovingIndex("End", 2, LEN)).toBe(LEN - 1);
  });

  it("returns null for keys that are not navigation keys", () => {
    expect(nextRovingIndex("Enter", 0, LEN)).toBeNull();
    expect(nextRovingIndex(" ", 0, LEN)).toBeNull();
    expect(nextRovingIndex("Tab", 0, LEN)).toBeNull();
    expect(nextRovingIndex("a", 0, LEN)).toBeNull();
  });

  it("returns null when there are no items", () => {
    expect(nextRovingIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("stays in range from any starting index", () => {
    for (let i = 0; i < LEN; i++) {
      const down = nextRovingIndex("ArrowDown", i, LEN);
      const up = nextRovingIndex("ArrowUp", i, LEN);
      expect(down).toBeGreaterThanOrEqual(0);
      expect(down).toBeLessThan(LEN);
      expect(up).toBeGreaterThanOrEqual(0);
      expect(up).toBeLessThan(LEN);
    }
  });
});
