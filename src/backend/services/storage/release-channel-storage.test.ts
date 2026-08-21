import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseCache } from "./release-channel-storage";

const { decryptStringMock, encryptStringMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  decryptStringMock: vi.fn(),
  encryptStringMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\YakShaver" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: decryptStringMock,
    encryptString: encryptStringMock,
  },
}));

vi.mock("node:fs", () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readFile: readFileMock,
    unlink: vi.fn(),
    writeFile: writeFileMock,
  },
}));

import { ReleaseChannelStorage } from "./release-channel-storage";

const releaseCache: ReleaseCache = {
  version: 1,
  releases: [
    {
      prNumber: "42",
      tag: "beta.42.1",
      publishedAt: "2026-01-01T00:00:00Z",
    },
  ],
  fetchedAt: 1_800_000_000_000,
  etag: '"release-etag"',
  blockedUntil: 1_800_000_060_000,
};

describe("ReleaseChannelStorage public release cache", () => {
  let storage: ReleaseChannelStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    // @ts-expect-error Reset the private singleton for test isolation.
    ReleaseChannelStorage.instance = null;
    storage = ReleaseChannelStorage.getInstance();
  });

  it("returns null when no public release cache exists", async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

    await expect(storage.getReleaseCache()).resolves.toBeNull();
  });

  it("loads the minimal public release cache from plain JSON", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(releaseCache));

    await expect(storage.getReleaseCache()).resolves.toEqual(releaseCache);
    expect(readFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]release-cache\.json$/),
      "utf8",
    );
    expect(decryptStringMock).not.toHaveBeenCalled();
  });

  it("writes the minimal public release cache without safeStorage encryption", async () => {
    await storage.setReleaseCache(releaseCache);

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]release-cache\.json$/),
      JSON.stringify(releaseCache),
      "utf8",
    );
    expect(encryptStringMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "an unversioned cache",
      cache: {
        releases: [
          {
            id: 1,
            tag_name: "beta.42.1",
            name: "PR #42 build",
            body: "full markdown body",
            prerelease: true,
            published_at: "2026-01-01T00:00:00Z",
            html_url: "https://example.com",
          },
        ],
        fetchedAt: 1_800_000_000_000,
        etag: '"stale-etag"',
      },
    },
    {
      name: "a cache from another schema version",
      cache: { ...releaseCache, version: 2 },
    },
  ])("treats $name as a miss so its ETag cannot be reused", async ({ cache }) => {
    readFileMock.mockResolvedValue(JSON.stringify(cache));

    await expect(storage.getReleaseCache()).resolves.toBeNull();
  });

  it("rejects an invalid publication date in the current cache schema", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...releaseCache,
        releases: [{ ...releaseCache.releases[0], publishedAt: "not-a-date" }],
      }),
    );

    await expect(storage.getReleaseCache()).rejects.toThrow(
      "GitHub release cache has an invalid structure",
    );
  });
});
