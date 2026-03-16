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

/**
 * Converts a camelCase or PascalCase key into a human-readable title with spaces.
 * Acronyms (consecutive uppercase letters) are kept together.
 *
 * @param key - The camelCase or PascalCase key to format.
 * @returns The formatted title string.
 *
 * @example
 * formatKeyAsTitle("projectPromptSelection") // "Project Prompt Selection"
 * formatKeyAsTitle("ProjectName")            // "Project Name"
 * formatKeyAsTitle("URLField")               // "URL Field"
 * formatKeyAsTitle("Title")                  // "Title"
 */
export function formatKeyAsTitle(key: string): string {
  return (
    key
      // Insert space between an acronym run and the next capitalised word: "URLField" → "URL Field"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // Insert space between a lowercase letter and the next uppercase letter: "camelCase" → "camel Case"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Capitalise the first character
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * Generates initials from a name string.
 * Returns the first letter of the first two words in uppercase.
 * Returns "U" if the name is undefined or empty.
 *
 * @param name - The full name to generate initials from.
 * @returns {string} The initials (up to 2 characters).
 */
export const getInitials = (name: string | undefined): string => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};
