import { beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeClient } from "./youtube-client";

// Hoisted mocks shared across the module mocks below.
const mocks = vi.hoisted(() => ({
  authorizeYouTubeWithBackend: vi.fn(),
  clearYouTubeTokens: vi.fn(),
  getYouTubeTokens: vi.fn(),
  channelsList: vi.fn(),
  userinfoGet: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn().mockReturnValue("/app") },
}));

vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
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
