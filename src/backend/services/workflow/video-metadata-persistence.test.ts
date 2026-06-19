import { describe, expect, it } from "vitest";
import type { VideoUploadResult } from "../auth/types";
import { decideVideoMetadataPersistence } from "./video-metadata-persistence";

/**
 * #808: Desktop-recorded YakShaves intermittently saved without `videoEmbedUrl`/`videoFile`.
 *
 * The embed URL used to be written ONLY by the UI in response to a workflow-progress event.
 * When that event was missed or coalesced, the saved shave had no `videoEmbedUrl`, so the
 * Tenant view rendered no preview. These tests capture the backend backstop decision that now
 * guarantees the field is persisted from the authoritative upload result.
 */
describe("decideVideoMetadataPersistence (#808)", () => {
  const successfulUpload: VideoUploadResult = {
    success: true,
    origin: "upload",
    data: {
      videoId: "abc123",
      title: "My Recording",
      description: "",
      url: "https://youtube.com/watch?v=abc123",
      duration: 42,
    },
  };

  it("persists the embed URL for an uploaded video when the shave has none (the bug)", () => {
    // This is the regression: the UI never wrote videoEmbedUrl (missed/coalesced progress
    // event), so the shave's videoEmbedUrl is still unset. The backstop must fill it in.
    const action = decideVideoMetadataPersistence(successfulUpload, null);

    expect(action).toEqual({
      kind: "setEmbedUrl",
      url: "https://youtube.com/watch?v=abc123",
    });
  });

  it("treats undefined existing embed URL the same as null", () => {
    const action = decideVideoMetadataPersistence(successfulUpload, undefined);

    expect(action).toEqual({
      kind: "setEmbedUrl",
      url: "https://youtube.com/watch?v=abc123",
    });
  });

  it("does NOT clobber an embed URL the UI already wrote", () => {
    // The UI path won the race and already persisted the URL — backstop must be a no-op so it
    // never overwrites a (possibly metadata-updated) value.
    const action = decideVideoMetadataPersistence(
      successfulUpload,
      "https://youtube.com/watch?v=already-set",
    );

    expect(action).toEqual({ kind: "none" });
  });

  it("attaches a video source for external-origin videos", () => {
    const externalResult: VideoUploadResult = {
      success: true,
      origin: "external",
      data: {
        videoId: "ext1",
        title: "External Video",
        description: "",
        url: "https://youtube.com/watch?v=ext1",
        duration: 100,
      },
    };

    const action = decideVideoMetadataPersistence(externalResult, null);

    expect(action).toEqual({
      kind: "attachVideoSource",
      title: "External Video",
      sourceUrl: "https://youtube.com/watch?v=ext1",
      durationSeconds: 100,
    });
  });

  it("uses -1 for unknown duration on external sources", () => {
    const externalResult: VideoUploadResult = {
      success: true,
      origin: "external",
      data: {
        videoId: "ext2",
        title: "External Video",
        description: "",
        url: "https://youtube.com/watch?v=ext2",
      },
    };

    const action = decideVideoMetadataPersistence(externalResult, null);

    expect(action).toEqual({
      kind: "attachVideoSource",
      title: "External Video",
      sourceUrl: "https://youtube.com/watch?v=ext2",
      durationSeconds: -1,
    });
  });

  it("does nothing when the upload did not succeed", () => {
    const failed: VideoUploadResult = {
      success: false,
      origin: "upload",
      error: "upload failed",
    };

    expect(decideVideoMetadataPersistence(failed, null)).toEqual({ kind: "none" });
  });

  it("does nothing when there is no URL even if marked successful", () => {
    const noUrl = {
      success: true,
      origin: "upload",
      data: { videoId: "x", title: "x", description: "", url: "" },
    } as VideoUploadResult;

    expect(decideVideoMetadataPersistence(noUrl, null)).toEqual({ kind: "none" });
  });
});
