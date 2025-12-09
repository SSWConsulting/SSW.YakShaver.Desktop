import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IFileService } from "../file/file-service";
import { FFmpegService } from "./ffmpeg-service";
import type { IProcessSpawner } from "./types";

function createMockChildProcess(): ChildProcess {
  const process = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  process.stderr = new EventEmitter();
  process.stdout = new EventEmitter();
  return process as ChildProcess;
}

function createMockFileSystem(): IFileService {
  return {
    access: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
}

describe("FFmpegService", () => {
  let mockFileSystem: IFileService;
  let mockProcessSpawner: IProcessSpawner;
  let mockChildProcess: ReturnType<typeof createMockChildProcess>;

  beforeEach(() => {
    mockChildProcess = createMockChildProcess();

    mockFileSystem = createMockFileSystem();

    mockProcessSpawner = {
      spawn: vi.fn().mockReturnValue(mockChildProcess),
    };
  });

  describe("ConvertVideoToMp3", () => {
    it("should resolve with output path on successful conversion", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.ConvertVideoToMp3("/input/video.mp4", "/output/audio.mp3");

      // Simulate successful process completion after promise is set up
      setImmediate(() => mockChildProcess.emit("close", 0));

      const result = await resultPromise;
      expect(result).toBe("/output/audio.mp3");
      expect(mockProcessSpawner.spawn).toHaveBeenCalledWith(
        "/mock/ffmpeg",
        expect.arrayContaining(["-i", "/input/video.mp4", "/output/audio.mp3"]),
      );
    });

    it("should reject when ffmpeg process fails", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.ConvertVideoToMp3("/input/video.mp4", "/output/audio.mp3");

      setImmediate(() => {
        mockChildProcess.emit("close", 1);
      });

      await expect(resultPromise).rejects.toThrow("FFmpeg process exited with code 1");
    });

    it("should reject when input file does not exist", async () => {
      mockFileSystem.access = vi.fn().mockRejectedValue(new Error("ENOENT"));

      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      await expect(
        service.ConvertVideoToMp3("/nonexistent/video.mp4", "/output/audio.mp3"),
      ).rejects.toThrow("The specified input file does not exist: /nonexistent/video.mp4");
    });

    it("should reject when ffmpeg binary does not exist", async () => {
      mockFileSystem.access = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("ENOENT"));

      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      await expect(
        service.ConvertVideoToMp3("/input/video.mp4", "/output/audio.mp3"),
      ).rejects.toThrow("FFmpeg binary not found at: /mock/ffmpeg");
    });

    it("should call onProgress callback with progress updates", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);
      const onProgress = vi.fn();

      const resultPromise = service.ConvertVideoToMp3(
        "/input/video.mp4",
        "/output/audio.mp3",
        onProgress,
      );

      setImmediate(() => {
        mockChildProcess.stderr?.emit("data", Buffer.from("Duration: 00:01:00.00"));
        mockChildProcess.stderr?.emit("data", Buffer.from("time=00:00:30.00 speed=2.0x"));
        mockChildProcess.emit("close", 0);
      });

      await resultPromise;

      expect(onProgress).toHaveBeenCalledWith({
        percentage: 50,
        timeProcessed: "00:00:30",
        speed: "2.0x",
      });
    });

    it("should handle spawn error", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.ConvertVideoToMp3("/input/video.mp4", "/output/audio.mp3");

      setImmediate(() => mockChildProcess.emit("error", new Error("spawn ENOENT")));

      await expect(resultPromise).rejects.toThrow("Failed to start FFmpeg: spawn ENOENT");
    });
  });

  describe("captureNthFrame", () => {
    it("should resolve with output path on successful frame capture", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.captureNthFrame("/input/video.mp4", "/output/frame.jpg", 10);

      setImmediate(() => mockChildProcess.emit("close", 0));

      const result = await resultPromise;
      expect(result).toBe("/output/frame.jpg");
    });

    it("should throw for negative timestamp", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      await expect(
        service.captureNthFrame("/input/video.mp4", "/output/frame.jpg", -5),
      ).rejects.toThrow("Timestamp must be non-negative.");
    });

    it("should create output directory", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.captureNthFrame(
        "/input/video.mp4",
        "/output/frames/frame.jpg",
        10,
      );

      setImmediate(() => mockChildProcess.emit("close", 0));

      await resultPromise;

      expect(mockFileSystem.mkdir).toHaveBeenCalledWith("/output/frames", { recursive: true });
    });

    it("should format timestamp correctly in ffmpeg args", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.captureNthFrame(
        "/input/video.mp4",
        "/output/frame.jpg",
        3661.5,
      );

      setImmediate(() => mockChildProcess.emit("close", 0));

      await resultPromise;

      // 3661.5 seconds = 1 hour, 1 minute, 1 second, 500 milliseconds
      expect(mockProcessSpawner.spawn).toHaveBeenCalledWith(
        "/mock/ffmpeg",
        expect.arrayContaining(["-ss", "01:01:01.500"]),
      );
    });

    it("should reject when frame capture fails", async () => {
      const service = new FFmpegService("/mock/ffmpeg", mockFileSystem, mockProcessSpawner);

      const resultPromise = service.captureNthFrame("/input/video.mp4", "/output/frame.jpg", 10);

      setImmediate(() => {
        mockChildProcess.stderr?.emit("data", Buffer.from("Error capturing frame"));
        mockChildProcess.emit("close", 1);
      });

      await expect(resultPromise).rejects.toThrow("FFmpeg frame capture failed with code 1");
    });
  });

  describe("getInstance", () => {
    it("should return the same instance (singleton)", () => {
      const instance1 = FFmpegService.getInstance();
      const instance2 = FFmpegService.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
