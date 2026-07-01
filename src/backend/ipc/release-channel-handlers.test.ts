import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Keep Electron, the real autoUpdater, and encrypted storage out of this unit test — we're
// exercising the token-health gating logic in ReleaseChannelIPCHandlers (#919), not Electron
// itself.
vi.mock("electron", () => ({
  app: {
    getName: () => "YakShaver",
    getVersion: () => "1.2.3",
    isPackaged: true,
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
  ipcMain: { handle: vi.fn() },
}));

const checkForUpdatesMock = vi.fn();
const setFeedURLMock = vi.fn();
vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: undefined,
    allowPrerelease: false,
    allowDowngrade: false,
    requestHeaders: {},
    on: vi.fn(),
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
    expect(result).toEqual({ available: true, version: "beta.42.1" });
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
    expect(result).toEqual({ available: false });
  });
});
