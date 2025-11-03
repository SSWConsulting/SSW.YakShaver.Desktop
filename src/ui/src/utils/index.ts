/**
 * Recursively parses JSON strings within nested objects and arrays.
 * If a string is valid JSON, it will be parsed and the function will continue parsing its contents.
 * Useful for deeply parsing objects that may contain JSON-encoded strings at any level.
 *
 * @param {unknown} obj - The object, array, or value to deeply parse.
 * @returns {unknown} The deeply parsed object, array, or value.
 */
export const deepParseJson = (obj: unknown): unknown => {
  if (typeof obj === "string") {
    try {
      const parsed = JSON.parse(obj);
      return deepParseJson(parsed);
    } catch {
      return obj;
    }
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepParseJson(item));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepParseJson(value);
    }
    return result;
  }
  return obj;
};

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
