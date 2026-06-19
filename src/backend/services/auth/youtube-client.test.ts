import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserInfo } from "./types";
import { describeYouTubeAuthError, YouTubeAuthError } from "./youtube-auth-error";

// Electron + secure-storage deps are pulled in transitively by the module graph
// (YoutubeStorage -> safeStorage). Stub them so the module imports in node-env.
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

// The Google SDKs are only reached via getCurrentUser(), which we spy on — so we
// never exercise them. Stub the modules so the test stays hermetic and fast.
vi.mock("googleapis", () => ({ google: { oauth2: vi.fn(), youtube: vi.fn() } }));
vi.mock("google-auth-library", () => ({ OAuth2Client: vi.fn() }));

// The two collaborators authenticate() actually wires: the OAuth backend call we
// drive, and the telemetry sink whose context + reason tag we assert.
vi.mock("./youtube-oauth", () => ({
  authorizeYouTubeWithBackend: vi.fn(),
  convertToTokenData: vi.fn(),
  refreshYouTubeTokenWithBackend: vi.fn(),
}));
vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: vi.fn(() => "reported"),
}));

import { formatAndReportError } from "../../utils/error-utils";
import { YouTubeClient } from "./youtube-client";
import { authorizeYouTubeWithBackend } from "./youtube-oauth";

const mockAuthorize = vi.mocked(authorizeYouTubeWithBackend);
const mockReport = vi.mocked(formatAndReportError);

const SAMPLE_USER: UserInfo = { id: "u1", name: "Test User", email: "tester@example.com" };

// Proves the wiring in authenticate()'s catch block (#596): the right telemetry
// context + structured reason tag, and the honest user-facing copy — not just the
// helper functions in isolation. A regression (reverting the context to
// "youtube_upload", dropping the reason tag, or returning a raw error.message)
// would pass the helper tests but fails here.
describe("YouTubeClient.authenticate (#596 telemetry context + honest copy wiring)", () => {
  let client: YouTubeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = YouTubeClient.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { success: true, userInfo } and reports no error telemetry on success", async () => {
    mockAuthorize.mockResolvedValue(undefined as never);
    const getCurrentUser = vi.spyOn(client, "getCurrentUser").mockResolvedValue(SAMPLE_USER);

    const result = await client.authenticate();

    expect(result).toEqual({ success: true, userInfo: SAMPLE_USER });
    expect(getCurrentUser).toHaveBeenCalledOnce();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("on a timeout failure: returns the honest copy and reports telemetry as 'youtube_auth' with the reason tag", async () => {
    const err = new YouTubeAuthError("timeout", "Timed out waiting for YouTube OAuth tokens", {
      elapsedMs: 60000,
    });
    mockAuthorize.mockRejectedValue(err);

    const result = await client.authenticate();

    expect(result.success).toBe(false);
    expect(result.error).toBe(describeYouTubeAuthError("timeout"));
    // The exact diagnostic wiring #596 depends on: corrected context + structured reason.
    expect(mockReport).toHaveBeenCalledWith(err, "youtube_auth", { reason: "timeout" });
  });
});
