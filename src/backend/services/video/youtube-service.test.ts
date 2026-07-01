import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IProcessSpawner } from "../process/process-spawner";
import { YouTubeDownloadService } from "./youtube-service";

// Electron is only used for `app.isPackaged` in this module — stub it so the module imports
// cleanly under vitest's node environment.
vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

vi.mock("tmp", () => ({
  default: {
    tmpNameSync: vi.fn(() => "/tmp/mock-output.mp4"),
  },
}));

function createMockChildProcess(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child as ChildProcess;
}

describe("YouTubeDownloadService — #931 paths containing spaces", () => {
  let mockChildProcess: ReturnType<typeof createMockChildProcess>;
  let mockProcessSpawner: IProcessSpawner;

  beforeEach(() => {
    mockChildProcess = createMockChildProcess();
    mockProcessSpawner = {
      spawn: vi.fn().mockReturnValue(mockChildProcess),
    };
  });

  describe("downloadVideoToFile", () => {
    it("passes a binary path containing spaces (e.g. Windows profile path) straight through as the spawn command, unmodified", async () => {
      // Regression for #931: a naive implementation that builds a single command-line string
      // (or that re-splits the binary path on whitespace, as the previous `youtube-dl-exec` ->
      // `tinyspawn` dependency chain did internally) would corrupt this path and never spawn
      // the real binary.
      const binaryPathWithSpaces =
        "C:\\Users\\First Last\\AppData\\Local\\Programs\\yakshaver\\resources\\app.asar.unpacked\\node_modules\\youtube-dl-exec\\bin\\yt-dlp.exe";
      const service = new YouTubeDownloadService(binaryPathWithSpaces, mockProcessSpawner);

      const outputPathWithSpaces = "C:\\Users\\First Last\\AppData\\Local\\Temp\\video.mp4";
      const resultPromise = service.downloadVideoToFile(
        "https://www.youtube.com/watch?v=abc123",
        outputPathWithSpaces,
      );

      setImmediate(() => mockChildProcess.emit("close", 0));
      const result = await resultPromise;

      expect(result).toBe(outputPathWithSpaces);
      // The binary path is passed as `command`, untouched — never split, never re-parsed.
      expect(mockProcessSpawner.spawn).toHaveBeenCalledWith(
        binaryPathWithSpaces,
        expect.any(Array),
      );
    });

    it("passes an output path containing spaces as a single argv element (not split into multiple tokens)", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const outputPathWithSpaces = "/Users/First Last/Downloads/my video.mp4";

      const resultPromise = service.downloadVideoToFile(
        "https://www.youtube.com/watch?v=abc123",
        outputPathWithSpaces,
      );
      setImmediate(() => mockChildProcess.emit("close", 0));
      await resultPromise;

      const [, args] = (mockProcessSpawner.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const outputFlagIndex = args.indexOf("--output");
      expect(outputFlagIndex).toBeGreaterThanOrEqual(0);
      // The full path with its embedded space is exactly one argv element, immediately after
      // `--output` — never split across two array entries.
      expect(args[outputFlagIndex + 1]).toBe(outputPathWithSpaces);
      expect(args).not.toContain("First");
      expect(args).not.toContain("Last/Downloads/my");
    });

    it("builds the yt-dlp invocation as an argument array, never a concatenated command string", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const resultPromise = service.downloadVideoToFile(
        "https://www.youtube.com/watch?v=abc123",
        "/tmp/out with space.mp4",
      );
      setImmediate(() => mockChildProcess.emit("close", 0));
      await resultPromise;

      const [command, args] = (mockProcessSpawner.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(typeof command).toBe("string");
      expect(Array.isArray(args)).toBe(true);
      expect(args).toEqual([
        "--output",
        "/tmp/out with space.mp4",
        "--format",
        "mp4",
        "--restrict-filenames",
        "--no-warnings",
        "--quiet",
        "https://www.youtube.com/watch?v=abc123",
      ]);
    });

    it("logs the resolved download path and the exact command invocation", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const outputPath = "/Users/First Last/video.mp4";

      const resultPromise = service.downloadVideoToFile(
        "https://www.youtube.com/watch?v=abc123",
        outputPath,
      );
      setImmediate(() => mockChildProcess.emit("close", 0));
      await resultPromise;

      const loggedCalls = consoleSpy.mock.calls.flat().join("\n");
      expect(loggedCalls).toContain(outputPath);
      expect(loggedCalls).toContain("/usr/local/bin/yt-dlp");
      expect(loggedCalls).toContain("--output");

      consoleSpy.mockRestore();
    });

    it("rejects with the process stderr when yt-dlp exits non-zero", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const resultPromise = service.downloadVideoToFile(
        "https://www.youtube.com/watch?v=abc123",
        "/tmp/out.mp4",
      );

      setImmediate(() => {
        mockChildProcess.stderr?.emit("data", Buffer.from("ERROR: video unavailable"));
        mockChildProcess.emit("close", 1);
      });

      await expect(resultPromise).rejects.toThrow(/video unavailable/);
    });

    it("rejects when youtubeUrl is empty", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      await expect(service.downloadVideoToFile("   ")).rejects.toThrow("YouTube URL is required");
      expect(mockProcessSpawner.spawn).not.toHaveBeenCalled();
    });
  });

  describe("getVideoMetadata", () => {
    it("parses JSON metadata from stdout and returns success", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const resultPromise = service.getVideoMetadata("https://www.youtube.com/watch?v=abc123");

      setImmediate(() => {
        mockChildProcess.stdout?.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              id: "abc123",
              title: "Test Video",
              description: "desc",
              webpage_url: "https://www.youtube.com/watch?v=abc123",
              duration: 35,
            }),
          ),
        );
        mockChildProcess.emit("close", 0);
      });

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.data?.videoId).toBe("abc123");
      expect(result.data?.title).toBe("Test Video");
    });

    it("returns a failure result when yt-dlp fails", async () => {
      const service = new YouTubeDownloadService("/usr/local/bin/yt-dlp", mockProcessSpawner);
      const resultPromise = service.getVideoMetadata("https://www.youtube.com/watch?v=abc123");

      setImmediate(() => {
        mockChildProcess.stderr?.emit("data", Buffer.from("ERROR: unavailable"));
        mockChildProcess.emit("close", 1);
      });

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("unavailable");
    });
  });
});
