import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeYouTubeAuthError, YouTubeAuthError } from "./youtube-auth-error";

// Hoisted mocks shared across the module mocks below.
const mocks = vi.hoisted(() => ({
  authorizeYouTubeWithBackend: vi.fn(),
  clearYouTubeTokens: vi.fn(),
  getYouTubeTokens: vi.fn(),
  channelsList: vi.fn(),
  userinfoGet: vi.fn(),
  formatAndReportError: vi.fn(() => "reported"),
}));

// Electron + secure-storage deps are pulled in transitively by the module graph.
// Stub them so the module imports cleanly in node-env.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue("/tmp/userData"),
    getAppPath: vi.fn().mockReturnValue("/tmp/app"),
  },
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

vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: mocks.formatAndReportError,
}));

vi.mock("../storage/youtube-storage", () => ({
  YoutubeStorage: {
    getInstance: () => ({
      getYouTubeTokens: mocks.getYouTubeTokens,
      clearYouTubeTokens: mocks.clearYouTubeTokens,
      storeYouTubeTokens: vi.fn(),
    }),
  },
}));

vi.mock("./youtube-oauth", () => ({
  authorizeYouTubeWithBackend: mocks.authorizeYouTubeWithBackend,
  convertToTokenData: vi.fn(),
  refreshYouTubeTokenWithBackend: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    setCredentials() {}
  },
}));

vi.mock("googleapis", () => ({
  google: {
    oauth2: () => ({ userinfo: { get: mocks.userinfoGet } }),
    youtube: () => ({ channels: { list: mocks.channelsList } }),
  },
}));

import { YouTubeClient } from "./youtube-client";

const userInfoResponse = {
  data: { id: "u1", name: "Test User", email: "t@example.com", picture: "https://x/a.png" },
};

describe("YouTubeClient.authenticate — #672 connect-time channel validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A valid token is needed so getAuthenticatedClient() succeeds.
    mocks.getYouTubeTokens.mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 60_000,
    });
    mocks.authorizeYouTubeWithBackend.mockResolvedValue(undefined);
    mocks.userinfoGet.mockResolvedValue(userInfoResponse);
  });

  it("fails the connection (with actionable copy) when the account has no channel", async () => {
    mocks.channelsList.mockResolvedValue({ data: { items: [] } });

    const result = await YouTubeClient.getInstance().authenticate();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/doesn't have a YouTube channel/i);
    expect(result.error).toMatch(/youtube\.com/i);
    // Half-connected tokens must be cleared so the state stays disconnected.
    expect(mocks.clearYouTubeTokens).toHaveBeenCalledOnce();
  });

  it("succeeds when the account has a channel", async () => {
    mocks.channelsList.mockResolvedValue({
      data: { items: [{ snippet: { title: "My Channel" } }] },
    });

    const result = await YouTubeClient.getInstance().authenticate();

    expect(result.success).toBe(true);
    expect(result.userInfo?.channelName).toBe("My Channel");
    expect(mocks.clearYouTubeTokens).not.toHaveBeenCalled();
  });

  it("treats a channel with no title as connected (not a missing channel)", async () => {
    mocks.channelsList.mockResolvedValue({ data: { items: [{ snippet: {} }] } });

    const result = await YouTubeClient.getInstance().authenticate();

    expect(result.success).toBe(true);
    expect(result.userInfo?.channelName).toBeUndefined();
    expect(mocks.clearYouTubeTokens).not.toHaveBeenCalled();
  });
});

// Proves the wiring in authenticate()'s catch block (#596): the right telemetry
// context + structured reason tag, and the honest user-facing copy — not just the
// helper functions in isolation. A regression (reverting the context to
// "youtube_upload", dropping the reason tag, or returning a raw error.message)
// would pass the helper tests but fails here.
describe("YouTubeClient.authenticate (#596 telemetry context + honest copy wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getYouTubeTokens.mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 60_000,
    });
    mocks.userinfoGet.mockResolvedValue(userInfoResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { success: true, userInfo } and reports no error telemetry on success", async () => {
    mocks.authorizeYouTubeWithBackend.mockResolvedValue(undefined);
    mocks.channelsList.mockResolvedValue({
      data: { items: [{ snippet: { title: "My Channel" } }] },
    });

    const result = await YouTubeClient.getInstance().authenticate();

    expect(result.success).toBe(true);
    expect(result.userInfo).toBeDefined();
    expect(mocks.formatAndReportError).not.toHaveBeenCalled();
  });

  it("on a timeout failure: returns the honest copy and reports telemetry as 'youtube_auth' with the reason tag", async () => {
    const err = new YouTubeAuthError("timeout", "Timed out waiting for YouTube OAuth tokens", {
      elapsedMs: 60000,
    });
    mocks.authorizeYouTubeWithBackend.mockRejectedValue(err);

    const result = await YouTubeClient.getInstance().authenticate();

    expect(result.success).toBe(false);
    expect(result.error).toBe(describeYouTubeAuthError("timeout"));
    // The exact diagnostic wiring #596 depends on: corrected context + structured reason.
    expect(mocks.formatAndReportError).toHaveBeenCalledWith(err, "youtube_auth", {
      reason: "timeout",
    });
  });
});
