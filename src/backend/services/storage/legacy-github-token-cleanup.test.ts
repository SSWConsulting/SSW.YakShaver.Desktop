import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatAndReportErrorMock, unlinkMock } = vi.hoisted(() => ({
  formatAndReportErrorMock: vi.fn(),
  unlinkMock: vi.fn(),
}));
vi.mock("node:fs", () => ({ promises: { unlink: unlinkMock } }));
vi.mock("electron", () => ({ app: { getPath: () => "C:\\YakShaver" } }));
vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: formatAndReportErrorMock,
}));

import { removeLegacyGitHubToken } from "./legacy-github-token-cleanup";

describe("removeLegacyGitHubToken", () => {
  beforeEach(() => {
    unlinkMock.mockReset().mockResolvedValue(undefined);
    formatAndReportErrorMock.mockReset().mockReturnValue("permission denied");
  });

  it("deletes the encrypted token left by previous versions", async () => {
    await removeLegacyGitHubToken();

    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]yakshaver-tokens[\\/]github-token\.enc$/),
    );
  });

  it("does nothing when no legacy token exists", async () => {
    unlinkMock.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(removeLegacyGitHubToken()).resolves.toBeUndefined();
  });

  it("reports a non-ENOENT deletion failure without blocking startup", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "EPERM" });
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unlinkMock.mockRejectedValue(error);

    try {
      await expect(removeLegacyGitHubToken()).resolves.toBeUndefined();
      expect(formatAndReportErrorMock).toHaveBeenCalledWith(error, "remove_legacy_github_token");
      expect(warningSpy).toHaveBeenCalledWith(
        "Failed to remove the legacy GitHub token: permission denied",
      );
    } finally {
      warningSpy.mockRestore();
    }
  });
});
