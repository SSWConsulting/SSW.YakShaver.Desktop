import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./async-utils";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve when promise completes before timeout", async () => {
    const fastPromise = Promise.resolve("success");
    const result = await withTimeout(fastPromise, 1000);
    expect(result).toBe("success");
  });

  it("should resolve when promise resolves before timeout", async () => {
    const fastPromise = new Promise((resolve) => setTimeout(() => resolve("done"), 100));
    const timeoutPromise = withTimeout(fastPromise, 500);

    vi.advanceTimersByTime(100);

    await expect(timeoutPromise).resolves.toBe("done");
  });

  it("should reject with timeout error when promise takes too long", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));
    const timeoutPromise = withTimeout(slowPromise, 50);

    vi.advanceTimersByTime(50);

    await expect(timeoutPromise).rejects.toThrow("Operation timed out");
  });

  it("should include label in timeout error message", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));
    const timeoutPromise = withTimeout(slowPromise, 50, "database query");

    vi.advanceTimersByTime(50);

    await expect(timeoutPromise).rejects.toThrow("Timeout waiting for database query");
  });

  it("should reject when promise fails before timeout", async () => {
    const failingPromise = Promise.reject(new Error("Connection failed"));

    await expect(withTimeout(failingPromise, 1000)).rejects.toThrow("Connection failed");
  });

  it("should reject when promise rejects before timeout", async () => {
    const failingPromise = new Promise((_, reject) =>
      setTimeout(() => reject("Connection failed"), 100),
    );

    vi.advanceTimersByTime(100);

    await expect(withTimeout(failingPromise, 500)).rejects.toBe("Connection failed");
  });

  it("should return the correct value type", async () => {
    const numberPromise = Promise.resolve(42);
    const result = await withTimeout(numberPromise, 1000);
    expect(result).toBe(42);
  });

  it("should return obj type", async () => {
    const objectPromise = Promise.resolve({ id: 1, name: "test" });
    const objResult = await withTimeout(objectPromise, 1000);
    expect(objResult).toEqual({ id: 1, name: "test" });
  });
});
