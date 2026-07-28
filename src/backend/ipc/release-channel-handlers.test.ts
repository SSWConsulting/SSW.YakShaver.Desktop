import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Keep Electron and the real autoUpdater out of this unit test. The tests exercise anonymous
// public release access (#600) and the update-ready dialog's anti-stacking behavior (#456).
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
const quitAndInstallMock = vi.fn();
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
    on: (...args: [string, (...a: unknown[]) => void]) => autoUpdaterOnMock(...args),
    setFeedURL: (...args: unknown[]) => setFeedURLMock(...args),
    checkForUpdates: (...args: unknown[]) => checkForUpdatesMock(...args),
    quitAndInstall: (...args: unknown[]) => quitAndInstallMock(...args),
  },
}));

vi.mock("../index", () => ({ setIsQuitting: vi.fn() }));
vi.mock("../config/env", () => ({ config: { commitHash: () => null } }));

const getChannelMock = vi.fn();
const setChannelMock = vi.fn();
const getReleaseCacheMock = vi.fn();
const setReleaseCacheMock = vi.fn();
vi.mock("../services/storage/release-channel-storage", () => ({
  ReleaseChannelStorage: {
    getInstance: () => ({
      getChannel: getChannelMock,
      setChannel: setChannelMock,
      getReleaseCache: getReleaseCacheMock,
      setReleaseCache: setReleaseCacheMock,
    }),
  },
}));

import { ReleaseChannelIPCHandlers } from "./release-channel-handlers";

function releaseData() {
  return [
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
}

function releasesResponse(): Response {
  return new Response(JSON.stringify(releaseData()), {
    status: 200,
    headers: { "Content-Type": "application/json", etag: '"release-etag"' },
  });
}

function getRegisteredHandler(ipcMainHandleMock: Mock, channelName: string) {
  const call = ipcMainHandleMock.mock.calls.find(([channel]) => channel === channelName);
  if (!call) throw new Error(`No handler registered for ${channelName}`);
  // ipcMain.handle's mock records unknown arguments, so the registered callback cannot be
  // narrowed further without asserting the contract that ReleaseChannelIPCHandlers registers.
  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

function expectAnonymousReleaseRequest(fetchMock: Mock): void {
  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.anything() }),
    }),
  );
}

describe("ReleaseChannelIPCHandlers — public releases do not require a GitHub token (#600)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    getChannelMock.mockResolvedValue({ type: "pr", channel: "beta.42" });
    getReleaseCacheMock.mockResolvedValue(null);
    setReleaseCacheMock.mockResolvedValue(undefined);
    fetchMock = vi.fn().mockResolvedValue(releasesResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists public PR releases anonymously", async () => {
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

    expect(result.error).toBeUndefined();
    expect(result.releases).toEqual([expect.objectContaining({ prNumber: "42" })]);
    expectAnonymousReleaseRequest(fetchMock);
    expect(setReleaseCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        releases: releaseData(),
        etag: '"release-etag"',
      }),
    );
  });

  it("reuses a fresh release response persisted by a previous app session", async () => {
    getReleaseCacheMock.mockResolvedValue({
      releases: releaseData(),
      fetchedAt: Date.now(),
      etag: '"persisted-etag"',
    });
    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const listReleases = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:list-releases",
    );

    const result = (await listReleases()) as {
      releases: Array<{ prNumber: string }>;
    };

    expect(result.releases).toEqual([expect.objectContaining({ prNumber: "42" })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a persisted ETag and refreshes the persisted cache timestamp after a 304", async () => {
    const now = 1_800_000_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    getReleaseCacheMock.mockResolvedValue({
      releases: releaseData(),
      fetchedAt: now - 10 * 60 * 1000,
      etag: '"persisted-etag"',
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));

    try {
      const { ipcMain } = await import("electron");
      new ReleaseChannelIPCHandlers();
      const listReleases = getRegisteredHandler(
        ipcMain.handle as Mock,
        "release-channel:list-releases",
      );

      await listReleases();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ "If-None-Match": '"persisted-etag"' }),
        }),
      );
      expect(setReleaseCacheMock).toHaveBeenCalledWith(
        expect.objectContaining({ fetchedAt: now, etag: '"persisted-etag"' }),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("falls back to GitHub when the optional persisted cache cannot be read", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getReleaseCacheMock.mockRejectedValue(new Error("Encryption is not available"));

    try {
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

      expect(result.error).toBeUndefined();
      expect(result.releases).toEqual([expect.objectContaining({ prNumber: "42" })]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(warningSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load GitHub release cache"),
      );
    } finally {
      warningSpy.mockRestore();
    }
  });

  it.each([
    {
      name: "Retry-After",
      headers: new Headers({ "retry-after": "120" }),
      expectedBlockedUntil: 1_800_000_120_000,
    },
    {
      name: "X-RateLimit-Reset",
      headers: new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1800000180",
      }),
      expectedBlockedUntil: 1_800_000_180_000,
    },
    {
      name: "an excessive Retry-After value",
      headers: new Headers({ "retry-after": "999999999" }),
      expectedBlockedUntil: 1_800_003_600_000,
    },
    {
      name: "an expired X-RateLimit-Reset value",
      headers: new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1700000000",
      }),
      expectedBlockedUntil: 1_800_000_060_000,
    },
  ])("stops GitHub requests until $name permits retry", async ({
    headers,
    expectedBlockedUntil,
  }) => {
    const now = 1_800_000_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    getReleaseCacheMock.mockResolvedValue({
      releases: releaseData(),
      fetchedAt: now - 10 * 60 * 1000,
      etag: '"persisted-etag"',
    });
    fetchMock.mockResolvedValue(
      new Response("API rate limit exceeded", {
        status: 429,
        headers,
      }),
    );

    try {
      const { ipcMain } = await import("electron");
      new ReleaseChannelIPCHandlers();
      const listReleases = getRegisteredHandler(
        ipcMain.handle as Mock,
        "release-channel:list-releases",
      );

      const firstResult = (await listReleases()) as {
        releases: Array<{ prNumber: string }>;
        error?: string;
      };
      const secondResult = await listReleases();

      expect(firstResult.error).toBeUndefined();
      expect(firstResult.releases).toEqual([expect.objectContaining({ prNumber: "42" })]);
      expect(secondResult).toEqual(firstResult);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(setReleaseCacheMock).toHaveBeenCalledWith(
        expect.objectContaining({ blockedUntil: expectedBlockedUntil }),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("checks and downloads a public PR release anonymously", async () => {
    checkForUpdatesMock.mockResolvedValue({ updateInfo: { version: "beta.42.1" } });
    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    expect(result).toEqual({
      available: true,
      version: "beta.42.1",
      currentVersion: "1.2.3",
    });
    expect(setFeedURLMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "generic",
        url: expect.stringContaining("/releases/download/beta.42.1"),
      }),
    );
    expect(checkForUpdatesMock).toHaveBeenCalled();
    expectAnonymousReleaseRequest(fetchMock);
  });

  it("uses a fresh persisted cache for the first PR update check after launch", async () => {
    getReleaseCacheMock.mockResolvedValue({
      releases: releaseData(),
      fetchedAt: Date.now(),
      etag: '"persisted-etag"',
    });
    checkForUpdatesMock.mockResolvedValue({ updateInfo: { version: "beta.42.1" } });
    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    expect(result).toEqual({
      available: true,
      version: "beta.42.1",
      currentVersion: "1.2.3",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a fresh persisted cache when configuring the PR channel after launch", async () => {
    getReleaseCacheMock.mockResolvedValue({
      releases: releaseData(),
      fetchedAt: Date.now(),
      etag: '"persisted-etag"',
    });
    const handlers = new ReleaseChannelIPCHandlers();

    try {
      await handlers.configureAutoUpdater({ type: "pr", channel: "beta.42" });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(setFeedURLMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "generic",
          url: expect.stringContaining("/releases/download/beta.42.1"),
        }),
      );
    } finally {
      handlers.stopPeriodicUpdateChecks();
    }
  });

  it("reports the rate limit instead of claiming the selected PR has no releases", async () => {
    fetchMock.mockResolvedValue(
      new Response("API rate limit exceeded", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    );
    const { ipcMain } = await import("electron");
    new ReleaseChannelIPCHandlers();
    const checkForUpdates = getRegisteredHandler(
      ipcMain.handle as Mock,
      "release-channel:check-updates",
    );

    const result = await checkForUpdates();

    expect(result).toEqual({
      available: false,
      error: "GitHub API rate limit exceeded. Try again later.",
      currentVersion: "1.2.3",
    });
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
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

    // Resolve the first dialog and wait for the handler's .then/.finally chain to flush before
    // the test ends, matching the sibling test's vi.waitFor pattern rather than firing-and-forgetting.
    resolveFirstDialog?.({ response: 1 });
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1));
  });

  it("keeps suppressing duplicate reminders while a long-running dialog remains open", async () => {
    vi.useFakeTimers();
    try {
      showMessageBoxMock.mockImplementation(() => new Promise(() => {})); // never settles

      new ReleaseChannelIPCHandlers();

      emitAutoUpdaterEvent("update-downloaded");
      expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

      // Advance beyond both the removed five-minute watchdog and the ten-minute update interval.
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      // The original native dialog is still visible, so another event must remain suppressed.
      emitAutoUpdaterEvent("update-downloaded");
      expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the guard after a dialog error so a later event can retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    showMessageBoxMock
      .mockRejectedValueOnce(new Error("dialog failed"))
      .mockImplementationOnce(() => new Promise(() => {}));

    try {
      new ReleaseChannelIPCHandlers();

      emitAutoUpdaterEvent("update-downloaded");
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));

      emitAutoUpdaterEvent("update-downloaded");
      expect(showMessageBoxMock).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
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

  it("does not show another reminder after the user clicks Restart Now, even before quitAndInstall fires", async () => {
    // Regression coverage (review on #456): isUpdateDialogOpen resets in .finally() synchronously,
    // but the real quit (autoUpdater.quitAndInstall) is deferred via setImmediate. A second
    // "update-downloaded" event landing in that gap must not stack a dialog moments before the app
    // quits — pinned here via the isRestartingToInstall short-circuit.
    showMessageBoxMock.mockResolvedValue({ response: 0 }); // 0 = "Restart Now"

    new ReleaseChannelIPCHandlers();

    emitAutoUpdaterEvent("update-downloaded");
    await vi.waitFor(() => expect(showMessageBoxMock).toHaveBeenCalledTimes(1));

    // A second event landing after the dialog resolved (isUpdateDialogOpen already released) but
    // before the deferred quitAndInstall() fires must still be suppressed.
    emitAutoUpdaterEvent("update-downloaded");

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);

    // Let the deferred quitAndInstall() flush before the test ends, so it doesn't fire during a
    // later test.
    await vi.waitFor(() => expect(quitAndInstallMock).toHaveBeenCalledTimes(1));
  });
});
