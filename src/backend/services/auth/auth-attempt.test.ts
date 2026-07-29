import { describe, expect, it } from "vitest";
import { isCurrentAuthAttempt } from "./auth-attempt";

describe("auth-attempt", () => {
  it("accepts a callback from the attempt being waited on", () => {
    expect(isCurrentAuthAttempt("attempt-1", "attempt-1")).toBe(true);
  });

  it("rejects a callback from an earlier attempt", () => {
    expect(isCurrentAuthAttempt("attempt-1", "attempt-2")).toBe(false);
  });

  // An attempt started before this shipped, or a flow that carries no id, must still fail fast
  // rather than hang until its timeout — so a missing id on either side is not a mismatch.
  it.each([
    ["callback has no id", null, "attempt-2"],
    ["waiter has no id", "attempt-1", undefined],
    ["neither has an id", undefined, undefined],
  ])("accepts the callback when %s", (_case, callbackId, waitingId) => {
    expect(isCurrentAuthAttempt(callbackId, waitingId)).toBe(true);
  });
});
