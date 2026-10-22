import { describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../auth/types";
import {
  ingestRecordingAsync,
  LOCAL_SAVE_UPLOAD_RESULT,
  type RecordingIngestDeps,
} from "./video-ingest";
import type { StageSink } from "./youtube-stage-decisions";

const FILE_PATH = "/tmp/recording.webm";
const LOCAL_FOLDER = "/videos/YakShaver/2026-10-22 0905";

const UPLOADED: VideoUploadResult = {
  success: true,
  origin: "upload",
  data: { videoId: "vid-1", title: "t", description: "d", url: "https://youtu.be/vid-1" },
};

function createDeps(isAuthenticated: boolean, uploadResult: VideoUploadResult = UPLOADED) {
  const deps = {
    youtube: {
      isAuthenticated: vi.fn().mockResolvedValue(isAuthenticated),
      uploadVideo: vi.fn().mockResolvedValue({ ...uploadResult }),
    },
    localVideoStorage: { saveRecordingAsync: vi.fn().mockResolvedValue(LOCAL_FOLDER) },
  } satisfies RecordingIngestDeps;
  return deps;
}

function createSink(): StageSink {
  return { completeStage: vi.fn(), failStage: vi.fn(), skipStage: vi.fn() };
}

describe("ingestRecordingAsync", () => {
  it("#1062: keeps the recording locally (not an error) when no video host is connected", async () => {
    const deps = createDeps(false);
    const sink = createSink();

    const result = await ingestRecordingAsync(FILE_PATH, 42, deps, sink);

    expect(deps.youtube.uploadVideo).not.toHaveBeenCalled();
    expect(deps.localVideoStorage.saveRecordingAsync).toHaveBeenCalledWith(FILE_PATH);
    expect(result).toEqual({ youtubeResult: LOCAL_SAVE_UPLOAD_RESULT, localFolder: LOCAL_FOLDER });
    expect(sink.failStage).not.toHaveBeenCalled();
    expect(sink.completeStage).toHaveBeenCalledWith(ProgressStage.UPLOADING_VIDEO, {
      filePath: FILE_PATH,
      sourceOrigin: "local",
      localFolder: LOCAL_FOLDER,
      uploadResult: LOCAL_SAVE_UPLOAD_RESULT,
    });
  });

  it("reuses the existing local folder on a retry instead of copying the video again", async () => {
    const deps = createDeps(false);
    const sink = createSink();

    const result = await ingestRecordingAsync(FILE_PATH, 42, deps, sink, LOCAL_FOLDER);

    expect(deps.localVideoStorage.saveRecordingAsync).not.toHaveBeenCalled();
    expect(result.localFolder).toBe(LOCAL_FOLDER);
    expect(sink.completeStage).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      expect.objectContaining({ localFolder: LOCAL_FOLDER }),
    );
  });

  it("uploads to the connected video host and stamps the duration", async () => {
    const deps = createDeps(true);
    const sink = createSink();

    const result = await ingestRecordingAsync(FILE_PATH, 42, deps, sink);

    expect(deps.localVideoStorage.saveRecordingAsync).not.toHaveBeenCalled();
    expect(result.localFolder).toBeUndefined();
    expect(result.youtubeResult.data?.duration).toBe(42);
    expect(sink.completeStage).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      expect.objectContaining({ sourceOrigin: "upload" }),
    );
  });

  it("#672: still fails the stage when a connected host's upload fails", async () => {
    const deps = createDeps(true, { success: false, error: "No YouTube channel" });
    const sink = createSink();

    await ingestRecordingAsync(FILE_PATH, undefined, deps, sink);

    expect(deps.localVideoStorage.saveRecordingAsync).not.toHaveBeenCalled();
    expect(sink.failStage).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      "No YouTube channel",
    );
  });
});
