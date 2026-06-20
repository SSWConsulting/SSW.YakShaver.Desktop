/**
 * Minimal, dependency-free arg parser for the `yakshaver` CLI.
 *
 * Splits an argv list into positionals and `--flag value` / `--flag=value` /
 * boolean `--flag` options. Kept tiny and pure so it's trivially unit-testable.
 */

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
  /**
   * Every string value seen for a flag, keyed by flag name and preserving order
   * and repeats. `options` is last-write-wins; this is where repeatable flags
   * (e.g. `--arg`) collect their full list. Boolean flags do not appear here.
   */
  multiOptions: Record<string, string[]>;
}

const BOOLEAN_FLAGS = new Set(["off", "help", "dev", "json"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  const multiOptions: Record<string, string[]> = {};

  const recordValue = (key: string, value: string): void => {
    options[key] = value;
    const existing = multiOptions[key] ?? [];
    existing.push(value);
    multiOptions[key] = existing;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        recordValue(key, arg.slice(eq + 1));
        continue;
      }

      const key = arg.slice(2);
      const next = argv[i + 1];
      // Boolean flags, or a flag at the end / followed by another flag.
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        recordValue(key, next);
        i++;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, options, multiOptions };
}

/** Read a string option, throwing a clear error when required and missing. */
export function requireString(options: Record<string, string | boolean>, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name} option`);
  }
  return value;
}

/** Read an optional string option. */
export function optionalString(
  options: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Read every value supplied for a repeatable flag (e.g. `--arg a --arg b`),
 * preserving order and never splitting on spaces — so a single value may safely
 * contain spaces (a Windows path, a `--config=My File.json`, etc.).
 */
export function optionalStringArray(
  multiOptions: Record<string, string[]>,
  name: string,
): string[] | undefined {
  const values = multiOptions[name];
  return values && values.length > 0 ? [...values] : undefined;
}

/** Parse a `key=value,key2=value2` style option into a record. */
export function parseKeyValueList(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
