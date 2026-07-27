import { beforeEach, describe, expect, it, vi } from "vitest";

const { unlinkMock } = vi.hoisted(() => ({ unlinkMock: vi.fn() }));
vi.mock("node:fs", () => ({ promises: { unlink: unlinkMock } }));
vi.mock("electron", () => ({ app: { getPath: () => "C:\\YakShaver" } }));
vi.mock("../../utils/error-utils", () => ({ formatAndReportError: vi.fn() }));

import { removeLegacyGitHubToken } from "./legacy-github-token-cleanup";

describe("removeLegacyGitHubToken", () => {
  beforeEach(() => {
    unlinkMock.mockReset().mockResolvedValue(undefined);
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
});
