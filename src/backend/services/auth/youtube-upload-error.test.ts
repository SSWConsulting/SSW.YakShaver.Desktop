import { describe, expect, it } from "vitest";
import { describeYouTubeUploadError } from "./youtube-upload-error";

describe("describeYouTubeUploadError — #672 no-channel detection", () => {
  it.each([
    new Error("Request failed: youtubeSignupRequired"),
    new Error("The user is not a YouTube user."),
    { errors: [{ reason: "youtubeSignupRequired" }] },
    "channelNotFound",
  ])("flags the missing-channel case with actionable copy", (err) => {
    const msg = describeYouTubeUploadError(err);
    expect(msg).toMatch(/YouTube channel yet/i);
    expect(msg).toMatch(/youtube\.com/i);
  });

  it("passes through an unrelated error message unchanged", () => {
    expect(describeYouTubeUploadError(new Error("network timeout"))).toBe("network timeout");
  });
});
