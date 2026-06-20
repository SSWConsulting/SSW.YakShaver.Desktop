import { describe, expect, it, vi } from "vitest";
import type { VideoUploadResult } from "../auth/types";
import {
  applyVideoMetadataPersistence,
  decideVideoMetadataPersistence,
  derivePortalVideoFields,
  type VideoMetadataShaveStore,
} from "./video-metadata-persistence";

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

/**
 * #808 (one-sided-verification gap): the decision tests above only prove what SHOULD be written.
 * These tests exercise the actual wiring — applyVideoMetadataPersistence -> ShaveService writes —
 * against an in-memory fake, proving the backstop really persists the embed URL when missing and
 * really skips the write when one already exists (no clobber), plus the external-source branch.
 */
describe("applyVideoMetadataPersistence wiring (#808)", () => {
  const successfulUpload: VideoUploadResult = {
    success: true,
    origin: "upload",
    data: {
      videoId: "abc123",
      title: "My Recording",
      description: "",
      url: "https://www.youtube.com/watch?v=abc123",
      duration: 42,
    },
  };

  function makeStore(existing: { videoEmbedUrl?: string | null } | undefined): {
    store: VideoMetadataShaveStore;
    updateShave: ReturnType<typeof vi.fn>;
    attachVideoSourceToShave: ReturnType<typeof vi.fn>;
  } {
    const updateShave = vi.fn();
    const attachVideoSourceToShave = vi.fn();
    const store: VideoMetadataShaveStore = {
      getShaveById: () => existing,
      updateShave,
      attachVideoSourceToShave,
    };
    return { store, updateShave, attachVideoSourceToShave };
  }

  it("writes videoEmbedUrl when the shave has none (the backstop fires)", () => {
    const { store, updateShave, attachVideoSourceToShave } = makeStore({ videoEmbedUrl: null });

    const action = applyVideoMetadataPersistence(store, "shave-1", successfulUpload);

    expect(action).toEqual({ kind: "setEmbedUrl", url: "https://www.youtube.com/watch?v=abc123" });
    expect(updateShave).toHaveBeenCalledTimes(1);
    expect(updateShave).toHaveBeenCalledWith("shave-1", {
      videoEmbedUrl: "https://www.youtube.com/watch?v=abc123",
    });
    expect(attachVideoSourceToShave).not.toHaveBeenCalled();
  });

  it("does NOT write when the shave already has an embed URL (no clobber)", () => {
    const { store, updateShave, attachVideoSourceToShave } = makeStore({
      videoEmbedUrl: "https://www.youtube.com/watch?v=already-set",
    });

    const action = applyVideoMetadataPersistence(store, "shave-1", successfulUpload);

    expect(action).toEqual({ kind: "none" });
    expect(updateShave).not.toHaveBeenCalled();
    expect(attachVideoSourceToShave).not.toHaveBeenCalled();
  });

  it("attaches a video source for external origins (not updateShave)", () => {
    const external: VideoUploadResult = {
      success: true,
      origin: "external",
      data: {
        videoId: "ext1",
        title: "External Video",
        description: "",
        url: "https://www.youtube.com/watch?v=ext1",
        duration: 100,
      },
    };
    const { store, updateShave, attachVideoSourceToShave } = makeStore({ videoEmbedUrl: null });

    const action = applyVideoMetadataPersistence(store, "shave-1", external);

    expect(action.kind).toBe("attachVideoSource");
    expect(attachVideoSourceToShave).toHaveBeenCalledWith("shave-1", {
      title: "External Video",
      sourceUrl: "https://www.youtube.com/watch?v=ext1",
      durationSeconds: 100,
    });
    expect(updateShave).not.toHaveBeenCalled();
  });

  it("no-ops when there is no shave id", () => {
    const { store, updateShave, attachVideoSourceToShave } = makeStore({ videoEmbedUrl: null });

    expect(applyVideoMetadataPersistence(store, undefined, successfulUpload)).toEqual({
      kind: "none",
    });
    expect(updateShave).not.toHaveBeenCalled();
    expect(attachVideoSourceToShave).not.toHaveBeenCalled();
  });

  it("no-ops when the shave is not found", () => {
    const { store, updateShave, attachVideoSourceToShave } = makeStore(undefined);

    expect(applyVideoMetadataPersistence(store, "missing", successfulUpload)).toEqual({
      kind: "none",
    });
    expect(updateShave).not.toHaveBeenCalled();
    expect(attachVideoSourceToShave).not.toHaveBeenCalled();
  });
});

/**
 * #808 (Tenant-view payload): the portal WorkItemDto video fields must be set deterministically
 * from the authoritative upload result — never left to the LLM to copy. These tests prove the
 * derivation that the IPC handler applies before posting to the portal.
 */
describe("derivePortalVideoFields (#808 Tenant view)", () => {
  it("derives provider/url/embed from a YouTube watch URL", () => {
    const result: VideoUploadResult = {
      success: true,
      origin: "upload",
      data: {
        videoId: "abcdefghijk",
        title: "t",
        description: "",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    };

    expect(derivePortalVideoFields(result)).toEqual({
      uploadedVideoProvider: "youtube",
      uploadedVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      uploadedVideoEmbedUrl: "https://www.youtube.com/embed/abcdefghijk",
    });
  });

  it("normalizes youtu.be short links to canonical watch + embed forms", () => {
    const result: VideoUploadResult = {
      success: true,
      origin: "external",
      data: {
        videoId: "abcdefghijk",
        title: "t",
        description: "",
        url: "https://youtu.be/abcdefghijk",
      },
    };

    expect(derivePortalVideoFields(result)).toEqual({
      uploadedVideoProvider: "youtube",
      uploadedVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      uploadedVideoEmbedUrl: "https://www.youtube.com/embed/abcdefghijk",
    });
  });

  it("mirrors a non-YouTube URL with no provider/embed synthesis", () => {
    const result: VideoUploadResult = {
      success: true,
      origin: "external",
      data: {
        videoId: "x",
        title: "t",
        description: "",
        url: "https://vimeo.com/123456",
      },
    };

    expect(derivePortalVideoFields(result)).toEqual({
      uploadedVideoProvider: null,
      uploadedVideoUrl: "https://vimeo.com/123456",
      uploadedVideoEmbedUrl: "https://vimeo.com/123456",
    });
  });

  it("returns null when the upload failed (caller leaves model output untouched)", () => {
    expect(derivePortalVideoFields({ success: false, origin: "upload", error: "x" })).toBeNull();
  });

  it("returns null when there is no URL", () => {
    const noUrl = {
      success: true,
      origin: "upload",
      data: { videoId: "x", title: "x", description: "", url: "" },
    } as VideoUploadResult;

    expect(derivePortalVideoFields(noUrl)).toBeNull();
  });
});
