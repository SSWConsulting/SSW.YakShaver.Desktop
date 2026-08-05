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
