import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { readdir, stat } from "node:fs/promises";
import { resolveDownloadedFilePath } from "./yt-dlp-output";

describe("resolveDownloadedFilePath", () => {
  it("returns the newest matching output file", async () => {
    vi.mocked(readdir).mockResolvedValue(["abc.mp4", "abc.webm", "other.mp4"] as never);
    vi.mocked(stat).mockImplementation(async (filePath) => {
      const resolvedPath = String(filePath);
      if (resolvedPath.endsWith("abc.mp4")) {
        return { mtimeMs: 100, isFile: () => true } as any;
      }
      if (resolvedPath.endsWith("abc.webm")) {
        return { mtimeMs: 200, isFile: () => true } as any;
      }
      return { mtimeMs: 0, isFile: () => true } as any;
    });

    const resolved = await resolveDownloadedFilePath("/tmp/abc");
    expect(resolved).toBe("/tmp/abc.webm");
  });

  it("ignores temporary .download files", async () => {
    vi.mocked(readdir).mockResolvedValue(["abc.mp4.download", "abc.mp4"] as never);
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 1, isFile: () => true } as any);

    const resolved = await resolveDownloadedFilePath("/tmp/abc");
    expect(resolved).toBe("/tmp/abc.mp4");
  });

  it("throws when no output files exist", async () => {
    vi.mocked(readdir).mockResolvedValue(["other.mp4"] as never);
    await expect(resolveDownloadedFilePath("/tmp/abc")).rejects.toThrow(
      "youtube-download-service: download completed but output file was not found",
    );
  });
});
