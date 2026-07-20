import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Keep Electron, the real autoUpdater, and encrypted storage out of this unit test — we're
// exercising the token-health gating logic in ReleaseChannelIPCHandlers (#919), not Electron
// itself.
const showMessageBoxMock = vi.fn().mockResolvedValue({ response: 1 });
vi.mock("electron", () => ({
  app: {
    getName: () => "YakShaver",
    getVersion: () => "1.2.3",
    isPackaged: true,
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBoxMock(...args) },
  ipcMain: { handle: vi.fn() },
}));

const checkForUpdatesMock = vi.fn();
const setFeedURLMock = vi.fn();
// Capture registered autoUpdater listeners (keyed by event name) so tests can fire events like
// "update-downloaded" directly, the same way the real electron-updater instance would (#456).
const autoUpdaterListeners = new Map<string, Array<(...args: unknown[]) => void>>();
const autoUpdaterOnMock = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
  const listeners = autoUpdaterListeners.get(event) ?? [];
  listeners.push(listener);
  autoUpdaterListeners.set(event, listeners);
});
function emitAutoUpdaterEvent(event: string, ...args: unknown[]) {
  for (const listener of autoUpdaterListeners.get(event) ?? []) {
    listener(...args);
  }
}
vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: undefined,
    allowPrerelease: false,
    allowDowngrade: false,
    requestHeaders: {},
    on: (...args: [string, (...a: unknown[]) => void]) => autoUpdaterOnMock(...args),
    setFeedURL: (...args: unknown[]) => setFeedURLMock(...args),
    checkForUpdates: (...args: unknown[]) => checkForUpdatesMock(...args),
  },
}));

vi.mock("../index", () => ({ setIsQuitting: vi.fn() }));
vi.mock("../config/env", () => ({ config: { commitHash: () => null } }));

const verifyGitHubTokenMock = vi.fn();
vi.mock("../services/github/github-token-verifier", () => ({
  verifyGitHubToken: (...args: unknown[]) => verifyGitHubTokenMock(...args),
}));

const getTokenMock = vi.fn();
vi.mock("../services/storage/github-token-storage", () => ({
  GitHubTokenStorage: { getInstance: () => ({ getToken: getTokenMock }) },
}));

const getChannelMock = vi.fn();
const setChannelMock = vi.fn();
vi.mock("../services/storage/release-channel-storage", () => ({
  ReleaseChannelStorage: {
    getInstance: () => ({ getChannel: getChannelMock, setChannel: setChannelMock }),
  },
}));

import { ReleaseChannelIPCHandlers } from "./release-channel-handlers";

function releasesResponse(): Response {
  const releases = [
    {
      id: 1,
      tag_name: "beta.42.1",
      name: "PR #42 build",
      body: "PR #42",
      prerelease: true,
      published_at: "2026-01-01T00:00:00Z",
      html_url: "https://example.com",
    },
  ];
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => releases,
    text: async () => JSON.stringify(releases),
  } as unknown as Response;
}

// Reach into the private IPC-handler methods the same way the constructor wires them — via the
// ipcMain.handle mock calls — so the test exercises exactly what the renderer would trigger.
function getRegisteredHandler(ipcMainHandleMock: Mock, channelName: string) {
  const call = ipcMainHandleMock.mock.calls.find(([channel]) => channel === channelName);
  if (!call) throw new Error(`No handler registered for ${channelName}`);
  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("ReleaseChannelIPCHandlers — PR releases require a healthy GitHub token (#919)", () => {
  let fetchMock: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    getTokenMock.mockResolvedValue("some-token");
    getChannelMock.mockResolvedValue({ type: "pr", channel: "beta.42" });
    fetchMock = vi.fn().mockResolvedValue(releasesResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listReleases refuses to call the GitHub API and surfaces a clear error when the token is invalid", async () => {
    verifyGitHubTokenMock.mockResolvedValue({ isValid: false, error: "Invalid or expired token" });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = await listReleases();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      releases: [],
      error: expect.stringMatching(/invalid|expired/i),
    });
  });

  it("listReleases succeeds and calls the GitHub API when the token is healthy", async () => {
    verifyGitHubTokenMock.mockResolvedValue({ isValid: true, username: "octocat" });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = (await listReleases()) as {
      releases: Array<{ prNumber: string }>;
      error?: string;
    };

    expect(fetchMock).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0].prNumber).toBe("42");
  });

  it("checkForUpdates on a PR channel refuses to download when the token is invalid — the reported bug", async () => {
    verifyGitHubTokenMock.mockResolvedValue({ isValid: false, error: "Invalid or expired token" });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    // The core regression this issue is about: an invalid token must never reach the autoUpdater
    // or trigger a download.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
    expect(setFeedURLMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      error: expect.stringMatching(/invalid|expired/i),
    });
  });

  it("checkForUpdates on a PR channel proceeds to the autoUpdater when the token is healthy", async () => {
    verifyGitHubTokenMock.mockResolvedValue({ isValid: true, username: "octocat" });
    checkForUpdatesMock.mockResolvedValue({ updateInfo: { version: "beta.42.1" } });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    expect(setFeedURLMock).toHaveBeenCalled();
    expect(checkForUpdatesMock).toHaveBeenCalled();
    expect(result).toEqual({
      available: true,
      version: "beta.42.1",
      currentVersion: "1.2.3",
    });
  });

  it("caches a healthy token-health result within the 60s TTL — a second call within the window does not re-verify", async () => {
    vi.useFakeTimers();
    try {
      verifyGitHubTokenMock.mockResolvedValue({ isValid: true, username: "octocat" });

      const { ipcMain } = await import("electron");
      new ReleaseChannelIPCHandlers();
      const listReleases = getRegisteredHandler(
        ipcMain.handle as Mock,
        "release-channel:list-releases",
      );

      await listReleases();
      expect(verifyGitHubTokenMock).toHaveBeenCalledTimes(1);

      // Still within the 60s cache TTL — must reuse the cached result, not re-verify.
      vi.advanceTimersByTime(30 * 1000);
      await listReleases();
      expect(verifyGitHubTokenMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-verifies the token after the 60s cache TTL expires", async () => {
    vi.useFakeTimers();
    try {
      verifyGitHubTokenMock.mockResolvedValue({ isValid: true, username: "octocat" });

      const { ipcMain } = await import("electron");
      new ReleaseChannelIPCHandlers();
      const listReleases = getRegisteredHandler(
        ipcMain.handle as Mock,
        "release-channel:list-releases",
      );

      await listReleases();
      expect(verifyGitHubTokenMock).toHaveBeenCalledTimes(1);

      // Past the 60s cache TTL — must re-verify against GitHub rather than serve a stale result.
      vi.advanceTimersByTime(61 * 1000);
      await listReleases();
      expect(verifyGitHubTokenMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listReleases distinguishes 'no token configured' from 'invalid token' — no misleading invalid-token error", async () => {
    // Regression coverage (review on #939): a user who has never configured a GitHub token must
    // not see the same "invalid or expired" wording as someone whose saved token failed
    // verification — isGitHubTokenHealthy() must never even reach verifyGitHubToken() in this case.
    getTokenMock.mockResolvedValue(undefined);

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = await listReleases();

    expect(verifyGitHubTokenMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      releases: [],
      error: expect.not.stringMatching(/invalid or expired/i),
    });
  });

  it("checkForUpdates on a PR channel distinguishes 'no token configured' from 'invalid token'", async () => {
    getTokenMock.mockResolvedValue(undefined);

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    expect(verifyGitHubTokenMock).not.toHaveBeenCalled();
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      error: expect.not.stringMatching(/invalid or expired/i),
    });
  });

  it("does not report a rate-limited token as invalid — distinguishes 403 rate-limit from 401 invalid", async () => {
    // Regression coverage (review on #939): verifyGitHubToken() already distinguishes a rate-limit
    // (403) from an actually-invalid token (401) in its `error` field; isGitHubTokenHealthy() must
    // propagate that distinction rather than reporting both as "invalid or expired".
    verifyGitHubTokenMock.mockResolvedValue({ isValid: false, error: "Rate limit exceeded" });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = await listReleases();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      releases: [],
      error: expect.stringMatching(/rate limit/i),
    });
    expect((result as { error?: string }).error).toEqual(
      expect.not.stringMatching(/invalid or expired/i),
    );
  });

  it("does not report a network/transport failure as an invalid token — distinguishes offline/DNS/TLS errors from 401 invalid", async () => {
    // Regression coverage (muster review on #939): verifyGitHubToken()'s catch block surfaces the
    // raw fetch/DNS/TLS error text (e.g. "fetch failed") rather than "Invalid or expired token" —
    // isGitHubTokenHealthy() must not collapse that into the generic invalid-token message, since a
    // user who is simply offline has no evidence their token is actually bad.
    verifyGitHubTokenMock.mockResolvedValue({ isValid: false, error: "fetch failed" });

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = await listReleases();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      releases: [],
      error: expect.stringMatching(/couldn't verify|network/i),
    });
    expect((result as { error?: string }).error).toEqual(
      expect.not.stringMatching(/invalid or expired/i),
    );
  });

  it("configureAutoUpdater still (re)starts periodic checks on the unhealthy-token early-return path", async () => {
    // Regression coverage (review on #939): configureAutoUpdater() used to return early on an
    // unhealthy token without reaching the startPeriodicUpdateChecks() call at the end of the
    // method — meaning periodic checks would never (re)start later if the token became healthy
    // again without another explicit reconfigure call. Assert the timer gets armed even on this
    // early-return path by advancing past one interval and observing a checkForUpdates-driven call.
    vi.useFakeTimers();
    try {
      verifyGitHubTokenMock.mockResolvedValue({
        isValid: false,
        error: "Invalid or expired token",
      });
      getChannelMock.mockResolvedValue({ type: "pr", channel: "beta.42" });

      const handlers = new ReleaseChannelIPCHandlers();
      await handlers.configureAutoUpdater({ type: "pr", channel: "beta.42" });

      // The unhealthy token blocked configuration itself (no feed URL set)...
      expect(setFeedURLMock).not.toHaveBeenCalled();

      // ...but the periodic timer must still be armed: advancing past one interval should invoke
      // the gated checkForUpdates() path, which re-verifies the token via verifyGitHubToken().
      const callsBefore = verifyGitHubTokenMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
      expect(verifyGitHubTokenMock.mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not require a token at all for the latest stable channel", async () => {
    getChannelMock.mockResolvedValue({ type: "latest" });
    getTokenMock.mockResolvedValue(undefined);
    checkForUpdatesMock.mockResolvedValue(null);

    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    // verifyGitHubToken is never even consulted for the stable channel.
    expect(verifyGitHubTokenMock).not.toHaveBeenCalled();
    expect(result).toEqual({ available: false, currentVersion: "1.2.3" });
  });
});

describe("ReleaseChannelIPCHandlers — update-ready reminder dialog (#456)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoUpdaterListeners.clear();
    showMessageBoxMock.mockReset();
  });

  it("does not stack a second reminder dialog while the first is still awaiting a response", async () => {
    // The reported bug's second half: "If the reminder dialog is open already, a subsequent
    // update check should not open another reminder dialog on top of it." Simulate the first
    // dialog's promise never resolving (user hasn't answered yet) and fire a second
    // "update-downloaded" event (e.g. the periodic background check landing mid-dialog) — only one
    // dialog must ever be shown.
    let resolveFirstDialog: ((result: { response: number }) => void) | undefined;
    showMessageBoxMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstDialog = resolve;
        }),
    );

    new ReleaseChannelIPCHandlers();

    emitAutoUpdaterEvent("update-downloaded");
    emitAutoUpdaterEvent("update-downloaded");

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    // Resolve the first dialog so the test doesn't leave a dangling promise.
    resolveFirstDialog?.({ response: 1 });
  });

  it("does not show a reminder again this session after the user clicks Later — the originally reported bug", async () => {
    // The reported bug's first half: clicking "Remind me later" must stop further reminders for
    // the rest of the current session, even when the periodic ~10-minute check fires again.
    showMessageBoxMock.mockResolvedValue({ response: 1 }); // 1 = "Later"

    new ReleaseChannelIPCHandlers();

    emitAutoUpdaterEvent("update-downloaded");
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1));

    // Simulate the periodic check finding the same update again later in the session.
    emitAutoUpdaterEvent("update-downloaded");
    emitAutoUpdaterEvent("update-downloaded");

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
  });
});
