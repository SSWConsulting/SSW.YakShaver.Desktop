import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTitledFolderName,
  formatFolderStamp,
  LocalVideoStorageService,
  sanitizeFolderTitle,
} from "./local-video-storage";

// Electron is only used for the default root (`app.getPath("videos")`); tests pass their own root.
vi.mock("electron", () => ({
  app: { getPath: () => "/videos" },
}));

const RECORDED_AT = new Date(2026, 9, 22, 9, 5);

describe("folder naming", () => {
  it("formats a sortable local-time stamp", () => {
    expect(formatFolderStamp(RECORDED_AT)).toBe("2026-10-22 0905");
  });

  it("strips characters that are invalid in file names", () => {
    expect(sanitizeFolderTitle('🐛 Bug: "Login" fails / crashes?')).toBe(
      "🐛 Bug Login fails crashes",
    );
  });

  it("drops trailing dots and caps the length", () => {
    expect(sanitizeFolderTitle("Fix it...")).toBe("Fix it");
    expect(sanitizeFolderTitle("a".repeat(200))).toHaveLength(80);
  });

  it("rebuilds the titled name from the stamp so retries never stack titles", () => {
    expect(buildTitledFolderName("2026-10-22 0905", "First")).toBe("2026-10-22 0905 - First");
    expect(buildTitledFolderName("2026-10-22 0905 - First", "Second")).toBe(
      "2026-10-22 0905 - Second",
    );
    expect(buildTitledFolderName("2026-10-22 0905 (2)", "First")).toBe(
      "2026-10-22 0905 (2) - First",
    );
  });

  it("keeps just the stamp when the title has nothing usable", () => {
    expect(buildTitledFolderName("2026-10-22 0905", "???")).toBe("2026-10-22 0905");
  });
});

describe("LocalVideoStorageService", () => {
  let workDir: string;
  let rootDir: string;
  let sourceVideo: string;
  let service: LocalVideoStorageService;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "yakshaver-local-video-"));
    rootDir = path.join(workDir, "Videos", "YakShaver");
    sourceVideo = path.join(workDir, "temp-recording.webm");
    await fs.writeFile(sourceVideo, "video-bytes");
    service = new LocalVideoStorageService(rootDir);
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it("copies the recording into a stamped folder and keeps the original", async () => {
    const folder = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);

    expect(folder).toBe(path.join(rootDir, "2026-10-22 0905"));
    expect(await fs.readFile(path.join(folder, "recording.webm"), "utf8")).toBe("video-bytes");
    expect(await fs.readFile(sourceVideo, "utf8")).toBe("video-bytes");
  });

  it("reports where the copied recording lives so it can be retried later", async () => {
    const folder = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);
    const recordingPath = service.getRecordingFilePath(folder, sourceVideo);

    expect(recordingPath).toBe(path.join(folder, "recording.webm"));
    expect(await fs.readFile(recordingPath, "utf8")).toBe("video-bytes");
  });

  it("does not overwrite a recording made in the same minute", async () => {
    const first = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);
    const second = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);

    expect(second).toBe(`${first} (2)`);
  });

  it("writes the transcript next to the recording", async () => {
    const folder = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);
    await service.saveTranscriptAsync(folder, "hello world");

    expect(await fs.readFile(path.join(folder, "transcript.txt"), "utf8")).toBe("hello world");
  });

  it("renames the folder to include the work item title", async () => {
    const folder = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);
    const renamed = await service.renameWithTitleAsync(folder, "Login fails");

    expect(renamed).toBe(path.join(rootDir, "2026-10-22 0905 - Login fails"));
    expect(await fs.readFile(path.join(renamed, "recording.webm"), "utf8")).toBe("video-bytes");
  });

  it("leaves the folder alone when the title is already applied", async () => {
    const folder = await service.saveRecordingAsync(sourceVideo, RECORDED_AT);
    const renamed = await service.renameWithTitleAsync(folder, "Login fails");

    expect(await service.renameWithTitleAsync(renamed, "Login fails")).toBe(renamed);
  });

  it("only treats paths inside the root as openable", () => {
    expect(service.isWithinRootDir(rootDir)).toBe(true);
    expect(service.isWithinRootDir(path.join(rootDir, "2026-10-22 0905"))).toBe(true);
    expect(service.isWithinRootDir(path.join(rootDir, "..", "elsewhere"))).toBe(false);
    expect(service.isWithinRootDir(workDir)).toBe(false);
  });
});
