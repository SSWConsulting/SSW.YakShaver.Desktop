import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

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

const getChannelMock = vi.fn();
const setChannelMock = vi.fn();
vi.mock("../services/storage/release-channel-storage", () => ({
  ReleaseChannelStorage: {
    getInstance: () => ({ getChannel: getChannelMock, setChannel: setChannelMock }),
  },
}));

import { autoUpdater } from "electron-updater";
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
  return new Response(JSON.stringify(releases), {
    status: 200,
    headers: { "Content-Type": "application/json" },
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
    fetchMock = vi.fn().mockResolvedValue(releasesResponse());
    vi.stubGlobal("fetch", fetchMock);
    autoUpdater.requestHeaders = {};
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
    expect(autoUpdater.requestHeaders).not.toHaveProperty("Authorization");
  });

  it.each([
    { type: "latest" as const },
    { type: "pr" as const, channel: "beta.42" },
  ])("removes stale Authorization headers when configuring $type", async (channel) => {
    autoUpdater.requestHeaders = {
      Authorization: "Bearer legacy-token",
      "X-Custom-Header": "preserved",
    };
    const handlers = new ReleaseChannelIPCHandlers();

    await handlers.configureAutoUpdater(channel);

    expect(autoUpdater.requestHeaders).toEqual({ "X-Custom-Header": "preserved" });
    handlers.stopPeriodicUpdateChecks();
  });
});
