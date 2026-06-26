import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeStorage } from "../storage/youtube-storage";
import type { TokenData } from "./types";
import { YouTubeAuthError } from "./youtube-auth-error";
import { getYouTubeAuthUrlFromBackend, waitForYouTubeTokens } from "./youtube-oauth";

// Electron + secure-storage deps pulled in transitively by the module graph.
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: vi.fn().mockReturnValue("/tmp/userData") },
  shell: { openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

vi.mock("../../config/env", () => ({
  config: {
    portalApiUrl: vi.fn().mockReturnValue("https://api.test"),
    isDev: vi.fn().mockReturnValue(true),
    azure: vi.fn().mockReturnValue(undefined),
  },
}));

const TOKENS_UPDATED_EVENT = "youtube-tokens-updated";

/** Minimal storage double exposing on/off/getYouTubeTokens + a way to push tokens. */
function makeFakeStorage(initial: TokenData | null) {
  const emitter = new EventEmitter();
  let tokens = initial;
  return {
    on: (event: string, listener: () => void) => emitter.on(event, listener),
    off: (event: string, listener: () => void) => emitter.off(event, listener),
    getYouTubeTokens: vi.fn(async () => tokens),
    __arrive: (next: TokenData) => {
      tokens = next;
      emitter.emit(TOKENS_UPDATED_EVENT);
    },
  };
}

const SAMPLE_TOKENS: TokenData = {
  accessToken: "a",
  refreshToken: "r",
  expiresAt: 0,
  scope: [],
};

describe("waitForYouTubeTokens", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with a structured 'timeout' error when no callback arrives (#596)", async () => {
    const storage = makeFakeStorage(null) as unknown as YoutubeStorage;
    const promise = waitForYouTubeTokens(storage, 1000);
    // Attach the rejection handler BEFORE advancing timers so there is no
    // unhandled-rejection window.
    const expectation = expect(promise).rejects.toMatchObject({
      reason: "timeout",
      elapsedMs: expect.any(Number),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
    expect(await promise.catch((e) => e)).toBeInstanceOf(YouTubeAuthError);
  });

  it("resolves when tokens arrive via the storage event before the timeout", async () => {
    const storage = makeFakeStorage(null);
    const promise = waitForYouTubeTokens(storage as unknown as YoutubeStorage, 60000);
    await vi.advanceTimersByTimeAsync(0); // let the initial "already present?" check settle
    storage.__arrive(SAMPLE_TOKENS);
    await vi.advanceTimersByTimeAsync(0); // flush the async onTokensUpdated handler
    await expect(promise).resolves.toEqual(SAMPLE_TOKENS);
  });

  it("returns immediately when tokens are already present", async () => {
    const storage = makeFakeStorage(SAMPLE_TOKENS) as unknown as YoutubeStorage;
    await expect(waitForYouTubeTokens(storage, 60000)).resolves.toEqual(SAMPLE_TOKENS);
  });
});

describe("getYouTubeAuthUrlFromBackend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies a network failure as 'backend_unreachable'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(getYouTubeAuthUrlFromBackend()).rejects.toMatchObject({
      reason: "backend_unreachable",
    });
  });

  it("classifies a non-OK response as 'auth_start_failed' with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "service unavailable" }),
      }),
    );
    await expect(getYouTubeAuthUrlFromBackend()).rejects.toMatchObject({
      reason: "auth_start_failed",
      status: 503,
    });
  });

  it("returns the authorization URL on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authorizationUrl: "https://accounts.google.com/o/oauth2/auth?x=1" }),
      }),
    );
    await expect(getYouTubeAuthUrlFromBackend()).resolves.toBe(
      "https://accounts.google.com/o/oauth2/auth?x=1",
    );
  });
});
