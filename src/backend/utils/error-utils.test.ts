import { type Mock, describe, expect, it, vi } from "vitest";
import { formatAndReportError, formatErrorMessage } from "./error-utils";

vi.mock("../services/telemetry/telemetry-service", () => {
  const mockTrackError = vi.fn();
  return {
    TelemetryService: {
      getInstance: vi.fn(() => ({
        trackError: mockTrackError,
      })),
      _mockTrackError: mockTrackError,
    },
  };
});

async function getMockTrackError(): Promise<Mock> {
  const mod = await import("../services/telemetry/telemetry-service");
  return (mod.TelemetryService as unknown as { _mockTrackError: Mock })._mockTrackError;
}

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

describe("formatAndReportError", () => {
  it("should return the formatted error message for an Error object", () => {
    const error = new Error("Something went wrong");
    expect(formatAndReportError(error, "test_context")).toBe("Something went wrong");
  });

  it("should return the formatted error message for a string", () => {
    expect(formatAndReportError("string error", "test_context")).toBe("string error");
  });

  it("should return the formatted error message for an object", () => {
    const obj = { code: "ERR_001" };
    expect(formatAndReportError(obj, "test_context")).toBe('{"code":"ERR_001"}');
  });

  it("should call TelemetryService.trackError with the error and context", async () => {
    const mockTrackError = await getMockTrackError();
    mockTrackError.mockClear();

    const error = new Error("tracked error");
    formatAndReportError(error, "my_context", { userId: "123" });

    expect(mockTrackError).toHaveBeenCalledWith({
      error,
      context: "my_context",
      additionalProperties: { userId: "123" },
    });
  });

  it("should not throw when TelemetryService.trackError fails", async () => {
    const mockTrackError = await getMockTrackError();
    mockTrackError.mockImplementationOnce(() => {
      throw new Error("telemetry failure");
    });

    expect(() => formatAndReportError(new Error("app error"), "test_context")).not.toThrow();
    expect(formatAndReportError(new Error("app error"), "test_context")).toBe("app error");
  });
});
