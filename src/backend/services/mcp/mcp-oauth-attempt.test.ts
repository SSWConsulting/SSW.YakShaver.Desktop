import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../../config/env", () => ({
  config: {
    portalApiUrl: () => "https://api.test/api",
    isDev: () => true,
    azure: () => undefined,
  },
}));
vi.mock("../storage/mcp-oauth-token-storage", () => ({
  McpOAuthTokenStorage: {
    TOKENS_UPDATED_EVENT: "tokens-updated",
    AUTH_FAILED_EVENT: "auth-failed",
    getInstance: vi.fn(),
  },
}));

import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";
import { waitForTokens } from "./mcp-oauth";

const SERVER_ID = "server-1";

/**
 * Stands in for the real storage: no tokens on disk, and a real emitter so the failure signal
 * travels the same path it does in production.
 */
function fakeStorage() {
  const events = new EventEmitter();
  return {
    getTokensAsync: vi.fn().mockResolvedValue(null),
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => events.off(event, listener),
    emitFailure: (serverId: string, attemptId?: string | null) =>
      events.emit(McpOAuthTokenStorage.AUTH_FAILED_EVENT, serverId, attemptId),
    emitTokens: (serverId: string) =>
      events.emit(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, serverId),
  };
}

describe("waitForTokens attempt correlation", () => {
  it("fails fast when the failure belongs to the attempt being waited on", async () => {
    const storage = fakeStorage();
    const waiting = waitForTokens(
      storage as unknown as McpOAuthTokenStorage,
      SERVER_ID,
      5000,
      "attempt-2",
    );
    // waitForTokens awaits its "already have tokens?" check before subscribing.
    await Promise.resolve();

    storage.emitFailure(SERVER_ID, "attempt-2");

    await expect(waiting).rejects.toThrow(/cancelled or failed/i);
  });

  /**
   * The #1000 review case: a tab from a timed-out attempt is closed after the user has already
   * retried. Its failure names the same server, so without the attempt id it would cancel the
   * retry that is still legitimately in flight.
   */
  it("ignores a failure reported by an earlier attempt for the same server", async () => {
    vi.useFakeTimers();
    try {
      const storage = fakeStorage();
      const waiting = waitForTokens(
        storage as unknown as McpOAuthTokenStorage,
        SERVER_ID,
        5000,
        "attempt-2",
      );
      // Let waitForTokens get past its initial "already have tokens?" await and subscribe.
      await vi.advanceTimersByTimeAsync(0);

      storage.emitFailure(SERVER_ID, "attempt-1");

      // The stale failure must not settle the promise — only the timeout does.
      const settled = vi.fn();
      waiting.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);
      await expect(waiting).rejects.toThrow(/Timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A callback with no id at all (an attempt started before this shipped) must still fail fast
   * rather than regress into a hang.
   */
  it("still fails fast when the callback carries no attempt id", async () => {
    const storage = fakeStorage();
    const waiting = waitForTokens(
      storage as unknown as McpOAuthTokenStorage,
      SERVER_ID,
      5000,
      "attempt-2",
    );
    await Promise.resolve();

    storage.emitFailure(SERVER_ID, null);

    await expect(waiting).rejects.toThrow(/cancelled or failed/i);
  });

  it("ignores failures for a different server", async () => {
    vi.useFakeTimers();
    try {
      const storage = fakeStorage();
      const waiting = waitForTokens(
        storage as unknown as McpOAuthTokenStorage,
        SERVER_ID,
        5000,
        "attempt-2",
      );
      await vi.advanceTimersByTimeAsync(0);

      storage.emitFailure("some-other-server", "attempt-2");

      const settled = vi.fn();
      waiting.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);
      await expect(waiting).rejects.toThrow(/Timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
