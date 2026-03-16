import { describe, expect, it } from "vitest";
import { formatKeyAsTitle } from ".";

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
