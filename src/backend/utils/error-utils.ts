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
  return error instanceof Error ? error.message : String(error);
}
