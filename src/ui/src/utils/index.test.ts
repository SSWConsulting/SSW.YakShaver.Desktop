import { describe, expect, it } from "vitest";
import { formatKeyAsTitle, parseToolName, splitToolName } from "./";

describe("formatKeyAsTitle", () => {
  it("converts camelCase to spaced title case", () => {
    expect(formatKeyAsTitle("projectPromptSelection")).toBe("Project Prompt Selection");
  });

  it("converts PascalCase to spaced title case", () => {
    expect(formatKeyAsTitle("ProjectName")).toBe("Project Name");
  });

  it("keeps acronyms together and inserts space before the next word", () => {
    expect(formatKeyAsTitle("URLField")).toBe("URL Field");
  });

  it("handles leading acronym followed by more words", () => {
    expect(formatKeyAsTitle("MyURLField")).toBe("My URL Field");
  });

  it("leaves a single already-readable word unchanged", () => {
    expect(formatKeyAsTitle("Title")).toBe("Title");
  });

  it("capitalises a lowercase-starting key", () => {
    expect(formatKeyAsTitle("issueNumber")).toBe("Issue Number");
  });

  it("handles a single lowercase word", () => {
    expect(formatKeyAsTitle("status")).toBe("Status");
  });

  it("handles consecutive uppercase acronyms separated by words", () => {
    expect(formatKeyAsTitle("parseHTMLContent")).toBe("Parse HTML Content");
  });
});

describe("splitToolName", () => {
  it("splits on the '__' MCP system separator", () => {
    expect(splitToolName("Jira__getAccessibleAtlassianResources")).toEqual({
      server: "Jira",
      tool: "getAccessibleAtlassianResources",
    });
  });

  it("splits on the '.' AI-output separator", () => {
    expect(splitToolName("Yak_Video_Tools.capture_video_frame")).toEqual({
      server: "Yak_Video_Tools",
      tool: "capture_video_frame",
    });
  });

  it("prefers the '__' separator over '.' when both are present", () => {
    expect(splitToolName("Yak_Video_Tools__capture_video_frame")).toEqual({
      server: "Yak_Video_Tools",
      tool: "capture_video_frame",
    });
  });

  it("returns a null server when there is no prefix", () => {
    expect(splitToolName("issue_write")).toEqual({ server: null, tool: "issue_write" });
  });
});

describe("parseToolName", () => {
  it("formats a '__'-separated tool name", () => {
    expect(parseToolName("Jira__getAccessibleAtlassianResources")).toEqual({
      server: "Jira",
      tool: "Get Accessible Atlassian Resources",
    });
  });

  it("formats a '.'-separated tool name and de-underscores the server", () => {
    expect(parseToolName("Yak_Video_Tools.capture_video_frame")).toEqual({
      server: "Yak Video Tools",
      tool: "Capture Video Frame",
    });
  });

  it("returns a null server for an unprefixed tool name", () => {
    expect(parseToolName("issue_write")).toEqual({ server: null, tool: "Issue Write" });
  });
});
