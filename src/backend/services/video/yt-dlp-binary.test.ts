import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/userData",
  },
}));

vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolveYtDlpBinaryPath } from "./yt-dlp-binary";

const statMock = vi.mocked(stat);
const readFileMock = vi.mocked(readFile);

describe("resolveYtDlpBinaryPath", () => {
  it("returns nodeModulesPath when it is an executable file", async () => {
    const nodeModulesPath = "/project/node_modules/youtube-dl-exec/bin/yt-dlp";

    const originalPath = process.env.PATH;
    process.env.PATH = "";

    readFileMock.mockResolvedValue(Buffer.from("#!/bin/sh\necho ok\n") as never);
    statMock.mockImplementation(async (filePath) => {
      const resolvedPath = String(filePath);
      if (resolvedPath === "/userData/bin/yt-dlp/yt-dlp") {
        throw new Error("ENOENT");
      }
      if (resolvedPath === nodeModulesPath) {
        return {
          isFile: () => true,
          mode: 0o755,
        } as any;
      }
      throw new Error("ENOENT");
    });

    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;

    const result = await resolveYtDlpBinaryPath(nodeModulesPath);
    expect(result).toEqual({ binaryPath: nodeModulesPath, source: "nodeModules" });
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.PATH = originalPath;
  });

  it("downloads to userData when nodeModulesPath is not executable", async () => {
    const nodeModulesPath = "/project/node_modules/youtube-dl-exec/bin/yt-dlp";

    const originalPath = process.env.PATH;
    process.env.PATH = "";

    readFileMock.mockResolvedValue(Buffer.from("#!/usr/bin/env python3\nPK") as never);
    statMock.mockImplementation(async (filePath) => {
      const resolvedPath = String(filePath);
      if (resolvedPath === "/userData/bin/yt-dlp/yt-dlp") {
        throw new Error("ENOENT");
      }
      if (resolvedPath === nodeModulesPath) {
        return {
          isFile: () => true,
          mode: 0o755,
        } as any;
      }
      throw new Error("ENOENT");
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    (globalThis as any).fetch = fetchSpy;

    const result = await resolveYtDlpBinaryPath(nodeModulesPath);
    expect(result).toEqual({ binaryPath: "/userData/bin/yt-dlp/yt-dlp", source: "userData" });

    expect(mkdir).toHaveBeenCalledWith("/userData/bin/yt-dlp", { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      "/userData/bin/yt-dlp/yt-dlp.download",
      expect.any(Uint8Array),
    );
    expect(chmod).toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(
      "/userData/bin/yt-dlp/yt-dlp.download",
      "/userData/bin/yt-dlp/yt-dlp",
    );
    expect(unlink).toHaveBeenCalledWith("/userData/bin/yt-dlp/yt-dlp");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/releases/latest/download/");

    process.env.PATH = originalPath;
  });
});
