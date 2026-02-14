import { TelemetryService } from "../services/telemetry/telemetry-service";

/**
 * Formats an unknown error into a string message.
 * Useful for handling errors in catch blocks where the error type is unknown.
 *
 * @param error - The error to format (can be Error, string, or any other type)
 * @returns The formatted error message as a string
 *
 * @example
 * ```ts
 * try {
 *   // some code
 * } catch (error) {
 *   console.error(formatErrorMessage(error));
 * }
 * ```
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Formats an error message and optionally reports it to telemetry.
 * This is the preferred way to handle errors as it both formats the message
 * and sends error data to Application Insights (if user has consented).
 *
 * @param error - The error to format and report
 * @param context - A string describing where the error occurred (e.g., "database_query", "api_call")
 * @param additionalProperties - Additional context properties to include in telemetry
 * @returns The formatted error message as a string
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   const message = formatAndReportError(error, "my_service_operation", { userId: "123" });
 *   throw new Error(`Operation failed: ${message}`);
 * }
 * ```
 */
export function formatAndReportError(
  error: unknown,
  context: string,
  additionalProperties?: Record<string, string | number | boolean>,
): string {
  const message = formatErrorMessage(error);

  try {
    const telemetryService = TelemetryService.getInstance();
    const errorObj = error instanceof Error ? error : new Error(message);

    telemetryService.trackError({
      error: errorObj,
      context,
      additionalProperties,
    });
  } catch {
    // Silently fail if telemetry tracking fails - don't let telemetry errors break the app
  }

  return message;
}
