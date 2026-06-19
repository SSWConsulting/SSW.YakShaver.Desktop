import { describe, expect, it } from "vitest";
import {
  classifyYouTubeAuthError,
  describeYouTubeAuthError,
  YouTubeAuthError,
  type YouTubeAuthErrorReason,
} from "./youtube-auth-error";

describe("classifyYouTubeAuthError", () => {
  it("returns the structured reason from a YouTubeAuthError", () => {
    const reasons: YouTubeAuthErrorReason[] = [
      "backend_unreachable",
      "auth_start_failed",
      "timeout",
      "unknown",
    ];
    for (const reason of reasons) {
      expect(classifyYouTubeAuthError(new YouTubeAuthError(reason, "x"))).toBe(reason);
    }
  });

  it("does not guess from message text — non-YouTubeAuthError is 'unknown'", () => {
    expect(classifyYouTubeAuthError(new Error("Timed out waiting for YouTube OAuth tokens"))).toBe(
      "unknown",
    );
    expect(classifyYouTubeAuthError("timeout")).toBe("unknown");
    expect(classifyYouTubeAuthError(undefined)).toBe("unknown");
  });

  it("preserves status and elapsedMs metadata on the error", () => {
    const err = new YouTubeAuthError("auth_start_failed", "boom", { status: 503 });
    expect(err.status).toBe(503);
    const timeout = new YouTubeAuthError("timeout", "slow", { elapsedMs: 60000 });
    expect(timeout.elapsedMs).toBe(60000);
  });
});

describe("describeYouTubeAuthError", () => {
  it("returns distinct, non-empty, honest copy per reason", () => {
    const reasons: YouTubeAuthErrorReason[] = [
      "backend_unreachable",
      "auth_start_failed",
      "timeout",
      "unknown",
    ];
    const messages = reasons.map(describeYouTubeAuthError);
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(0);
      // Honest copy never claims success.
      expect(m.toLowerCase()).not.toContain("success");
    }
    // Each reason maps to a distinct message.
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it("the timeout message (the #596 symptom) is actionable — points at the device + retry", () => {
    const msg = describeYouTubeAuthError("timeout").toLowerCase();
    expect(msg).toContain("verification");
    expect(msg).toContain("connect");
  });

  it("the backend_unreachable message points at connectivity", () => {
    expect(describeYouTubeAuthError("backend_unreachable").toLowerCase()).toContain("connection");
  });
});
