/**
 * Minimal, dependency-free arg parser for the `yakshaver` CLI.
 *
 * Splits an argv list into positionals and `--flag value` / `--flag=value` /
 * boolean `--flag` options. Kept tiny and pure so it's trivially unit-testable.
 */

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(["off", "help", "dev", "json"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

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
        options[key] = arg.slice(eq + 1);
        continue;
      }

      const key = arg.slice(2);
      const next = argv[i + 1];
      // Boolean flags, or a flag at the end / followed by another flag.
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i++;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, options };
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
