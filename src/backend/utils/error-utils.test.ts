import { formatErrorMessage } from "./error-utils";

describe("formatErrorMessage", () => {
  it("should return the error message when given an Error object", () => {
    const error = new Error("Something went wrong");
    expect(formatErrorMessage(error)).toBe("Something went wrong");
  });

  it("should return the string when given a string", () => {
    const error = "A string error";
    expect(formatErrorMessage(error)).toBe("A string error");
  });

  it("should convert numbers to string", () => {
    expect(formatErrorMessage(404)).toBe("404");
  });

  it("should convert null to string", () => {
    expect(formatErrorMessage(null)).toBe("null");
  });

  it("should convert undefined to string", () => {
    expect(formatErrorMessage(undefined)).toBe("undefined");
  });

  it("should convert objects to JSON string showing contents", () => {
    const obj = { code: "ERR_001" };
    expect(formatErrorMessage(obj)).toBe('{"code":"ERR_001"}');
  });

  it("should handle complex objects", () => {
    const obj = { code: "ERR_001", details: { field: "email", reason: "invalid" } };
    expect(formatErrorMessage(obj)).toBe(
      '{"code":"ERR_001","details":{"field":"email","reason":"invalid"}}',
    );
  });

  it("should handle arrays", () => {
    const arr = ["error1", "error2"];
    expect(formatErrorMessage(arr)).toBe('["error1","error2"]');
  });
});
