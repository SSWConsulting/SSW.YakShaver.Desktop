import { describe, expect, it } from "vitest";
import { VIDEO_LINK_EMBEDDING_RULES } from "../../constants/prompts";
import { appendVideoInfoToSystemPrompt, NO_VIDEO_LINK_RULES } from "./prompts";

const UPLOADED = {
  success: true,
  origin: "upload" as const,
  data: {
    videoId: "abc",
    title: "t",
    description: "d",
    url: "https://youtu.be/abc",
    duration: 75,
  },
};

describe("appendVideoInfoToSystemPrompt", () => {
  it("gives the model the uploaded video URL, its duration and the embedding rules", () => {
    const prompt = appendVideoInfoToSystemPrompt("base", UPLOADED);

    expect(prompt).toContain("This is the uploaded video URL: https://youtu.be/abc.");
    expect(prompt).toContain("- minutes: 1");
    expect(prompt).toContain("- seconds: 15");
    expect(prompt).toContain(VIDEO_LINK_EMBEDDING_RULES);
    expect(prompt).not.toContain(NO_VIDEO_LINK_RULES);
  });

  it("does not repeat the embedding rules when the prompt already has them", () => {
    const prompt = appendVideoInfoToSystemPrompt(`base ${VIDEO_LINK_EMBEDDING_RULES}`, UPLOADED);

    expect(prompt.split(VIDEO_LINK_EMBEDDING_RULES)).toHaveLength(2);
  });

  it("#1062: tells the model there is no video when it was kept locally", () => {
    // A repo template's "Watch the video" line was kept with a made-up about:blank link.
    const prompt = appendVideoInfoToSystemPrompt("base", { success: false, origin: "local" });

    expect(prompt).toContain(NO_VIDEO_LINK_RULES);
    expect(prompt).not.toContain("This is the uploaded video URL");
    expect(prompt).not.toContain(VIDEO_LINK_EMBEDDING_RULES);
    expect(NO_VIDEO_LINK_RULES).toMatch(/Watch the video/);
    expect(NO_VIDEO_LINK_RULES).toMatch(/about:blank/);
  });

  it("adds the local video file for screenshot capture either way", () => {
    const prompt = appendVideoInfoToSystemPrompt("base", undefined, "C:/videos/rec.webm");

    expect(prompt).toContain("Video file available for screenshot capture: C:/videos/rec.webm.");
  });
});
