import { describe, expect, it } from "vitest";
import { parseFinalOutput, readReportedTitle, readWorkItemUrl } from "./final-output";

describe("parseFinalOutput", () => {
  it("reads the envelope the orchestrator produces", () => {
    expect(parseFinalOutput('{"Status":"Success","Title":"A title","URL":"https://x/1"}')).toEqual({
      Status: "Success",
      Title: "A title",
      URL: "https://x/1",
    });
  });

  it("strips the markdown code fence the model often wraps it in", () => {
    expect(parseFinalOutput('```json\n{"Status":"Success"}\n```')).toEqual({ Status: "Success" });
  });

  // #888: the fence handling has to CAPTURE the block, not delete the markers. These are the cases
  // a global substring-strip gets wrong, and this module is now the only implementation of them.
  it("accepts an uppercase fence", () => {
    expect(parseFinalOutput('```JSON\n{"URL":"https://x"}\n```')).toEqual({ URL: "https://x" });
  });

  it("accepts a fenced block preceded by prose", () => {
    expect(parseFinalOutput('Here is the result:\n```json\n{"URL":"https://x"}\n```')).toEqual({
      URL: "https://x",
    });
  });

  it("preserves backticks inside a value instead of mutating the payload", () => {
    const description = "run ```npm test``` first";
    const input = `\`\`\`json\n${JSON.stringify({ Description: description })}\n\`\`\``;

    expect(parseFinalOutput(input).Description).toBe(description);
  });

  it("parses bare JSON with no fence at all", () => {
    expect(parseFinalOutput('{"Title":"T"}')).toEqual({ Title: "T" });
  });

  it("drops a wrongly typed field instead of letting it through", () => {
    // The renderer used to write this straight into the shave's work_item_url column.
    const parsed = parseFinalOutput('{"Status":"Success","URL":5}');

    expect(parsed.URL).toBeUndefined();
    expect(parsed.Status).toBe("Success");
  });

  it("throws when the payload is not an object, which the renderer reports to the user", () => {
    expect(() => parseFinalOutput('"just a sentence"')).toThrow();
    expect(() => parseFinalOutput("not json at all")).toThrow();
  });
});

describe("readWorkItemUrl / readReportedTitle", () => {
  it("returns the trimmed values", () => {
    const output = '{"Title":"  A title  ","URL":"  https://x/1  "}';

    expect(readReportedTitle(output)).toBe("A title");
    expect(readWorkItemUrl(output)).toBe("https://x/1");
  });

  it("returns undefined instead of throwing on an unusable payload", () => {
    expect(readWorkItemUrl("I created the issue for you!")).toBeUndefined();
    expect(readReportedTitle(undefined)).toBeUndefined();
    expect(readReportedTitle('{"Title":""}')).toBeUndefined();
  });
});
