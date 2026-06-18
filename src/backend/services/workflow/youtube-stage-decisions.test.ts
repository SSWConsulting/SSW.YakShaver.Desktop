import { describe, expect, it } from "vitest";
import type { VideoUploadResult } from "../auth/types";
import {
  metadataVideoIdToUpdate,
  resolveUploadFailureMessage,
  uploadSucceeded,
} from "./youtube-stage-decisions";

const data = { videoId: "abc123", title: "t", description: "d", url: "https://youtu.be/abc123" };

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
