import { describe, expect, it, vi } from "vitest";
import { ProgressStage, type WorkflowStatus } from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../auth/types";
import {
  applyUploadStageOutcome,
  metadataVideoIdToUpdate,
  resolveMetadataStage,
  resolveUploadFailureMessage,
  type StageSink,
  shouldFailStageOnUnexpectedError,
  uploadSucceeded,
} from "./youtube-stage-decisions";

const data = { videoId: "abc123", title: "t", description: "d", url: "https://youtu.be/abc123" };

const makeSink = (): StageSink => ({
  completeStage: vi.fn(),
  failStage: vi.fn(),
  skipStage: vi.fn(),
});

describe("uploadSucceeded (#672 — green tick only on real upload)", () => {
  it("is true when the upload succeeded", () => {
    expect(uploadSucceeded({ success: true, data, origin: "upload" })).toBe(true);
  });

  it("is false when the upload failed (e.g. no YouTube channel, no throw)", () => {
    expect(uploadSucceeded({ success: false, error: "no channel" })).toBe(false);
  });

  it("is false for a success:false result even if data is somehow present", () => {
    expect(uploadSucceeded({ success: false, data })).toBe(false);
  });
});

describe("resolveUploadFailureMessage (#672 — fail with the right reason)", () => {
  it("uses the concrete client error when present", () => {
    expect(
      resolveUploadFailureMessage({
        success: false,
        error: "Your Google account has no YouTube channel",
      }),
    ).toBe("Your Google account has no YouTube channel");
  });

  it("falls back to a generic message when no error is given", () => {
    expect(resolveUploadFailureMessage({ success: false })).toBe("Video upload failed");
  });

  it("falls back when error is an empty string", () => {
    expect(resolveUploadFailureMessage({ success: false, error: "" })).toBe("Video upload failed");
  });
});

describe("metadataVideoIdToUpdate (#798 — only for videos we uploaded and own)", () => {
  const cases: Array<{ name: string; input: VideoUploadResult; expected: string | null }> = [
    {
      name: "owned upload with a videoId → returns the id (run metadata)",
      input: { success: true, data, origin: "upload" },
      expected: "abc123",
    },
    {
      name: "success with a videoId and no explicit origin (defaults to not-external) → returns id",
      input: { success: true, data },
      expected: "abc123",
    },
    {
      name: "external link (not owned) → null (skip)",
      input: { success: true, data, origin: "external" },
      expected: null,
    },
    {
      name: "failed upload → null (no green tick, no metadata)",
      input: { success: false, data, origin: "upload" },
      expected: null,
    },
    {
      name: "success but no data/videoId → null (skip)",
      input: { success: true, origin: "upload" },
      expected: null,
    },
    {
      name: "success but empty videoId → null (skip)",
      input: { success: true, data: { ...data, videoId: "" }, origin: "upload" },
      expected: null,
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(metadataVideoIdToUpdate(input)).toBe(expected);
    });
  }
});

describe("applyUploadStageOutcome (#672 — routes the Uploading Video stage)", () => {
  it("completes the stage with the upload payload on success", () => {
    const sink = makeSink();
    const result: VideoUploadResult = { success: true, data, origin: "upload" };

    applyUploadStageOutcome(result, "/tmp/v.mp4", sink);

    expect(sink.completeStage).toHaveBeenCalledWith(ProgressStage.UPLOADING_VIDEO, {
      filePath: "/tmp/v.mp4",
      sourceOrigin: "upload",
      uploadResult: result,
    });
    expect(sink.failStage).not.toHaveBeenCalled();
  });

  it("fails the stage with the concrete client error when the upload failed (no channel)", () => {
    const sink = makeSink();

    applyUploadStageOutcome(
      { success: false, error: "Your Google account has no YouTube channel" },
      "/tmp/v.mp4",
      sink,
    );

    expect(sink.failStage).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      "Your Google account has no YouTube channel",
    );
    expect(sink.completeStage).not.toHaveBeenCalled();
  });

  it("fails with the generic message when a failed upload has no error", () => {
    const sink = makeSink();

    applyUploadStageOutcome({ success: false }, "/tmp/v.mp4", sink);

    expect(sink.failStage).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      "Video upload failed",
    );
    expect(sink.completeStage).not.toHaveBeenCalled();
  });
});

describe("resolveMetadataStage (#798 — routes the Updating Metadata stage)", () => {
  it("returns the videoId and does NOT skip for an owned upload", () => {
    const sink = makeSink();

    const videoId = resolveMetadataStage({ success: true, data, origin: "upload" }, sink);

    expect(videoId).toBe("abc123");
    expect(sink.skipStage).not.toHaveBeenCalled();
  });

  it("skips the stage and returns null for an external link", () => {
    const sink = makeSink();

    const videoId = resolveMetadataStage({ success: true, data, origin: "external" }, sink);

    expect(videoId).toBeNull();
    expect(sink.skipStage).toHaveBeenCalledWith(ProgressStage.UPDATING_METADATA);
  });

  it("skips the stage and returns null for a failed upload", () => {
    const sink = makeSink();

    const videoId = resolveMetadataStage({ success: false, data, origin: "upload" }, sink);

    expect(videoId).toBeNull();
    expect(sink.skipStage).toHaveBeenCalledWith(ProgressStage.UPDATING_METADATA);
  });

  it("skips the stage and returns null when the upload has no videoId", () => {
    const sink = makeSink();

    const videoId = resolveMetadataStage({ success: true, origin: "upload" }, sink);

    expect(videoId).toBeNull();
    expect(sink.skipStage).toHaveBeenCalledWith(ProgressStage.UPDATING_METADATA);
  });
});

describe("shouldFailStageOnUnexpectedError (#306 — outer catch must not un-complete a finished stage)", () => {
  it("re-fails a stage that was genuinely interrupted mid-flight (in_progress)", () => {
    expect(shouldFailStageOnUnexpectedError("in_progress")).toBe(true);
  });

  it("fails a stage that never even started (not_started) — the error happened before it began", () => {
    expect(shouldFailStageOnUnexpectedError("not_started")).toBe(true);
  });

  it("does NOT re-fail a stage that already completed — a later, unrelated error must not silently un-complete a real success (#306)", () => {
    expect(shouldFailStageOnUnexpectedError("completed")).toBe(false);
  });

  it("does NOT re-fail a stage that was already skipped", () => {
    expect(shouldFailStageOnUnexpectedError("skipped")).toBe(false);
  });

  it("does NOT re-fail a stage that already failed (fault injection / earlier failure already recorded)", () => {
    expect(shouldFailStageOnUnexpectedError("failed")).toBe(false);
  });

  it("covers every WorkflowStatus value so a future status can't silently change behaviour unnoticed", () => {
    const decisions = {
      not_started: shouldFailStageOnUnexpectedError("not_started"),
      in_progress: shouldFailStageOnUnexpectedError("in_progress"),
      completed: shouldFailStageOnUnexpectedError("completed"),
      failed: shouldFailStageOnUnexpectedError("failed"),
      skipped: shouldFailStageOnUnexpectedError("skipped"),
    } satisfies Record<WorkflowStatus, boolean>;

    expect(decisions).toEqual({
      not_started: true,
      in_progress: true,
      completed: false,
      failed: false,
      skipped: false,
    });
  });
});
