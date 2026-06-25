/**
 * Human-readable rendering of bridge responses for the `yakshaver` CLI.
 * Extracted from index.ts so it can be unit-tested without executing main().
 */

export function printResult(label: string, data: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Pretty-print MCP server lists as a compact table-ish summary.
  if (Array.isArray(data)) {
    console.log(`${label} (${data.length}):`);
    for (const item of data) {
      printServerLine(item);
    }
    return;
  }

  // Removal responses are a bare { id, removed: true } envelope, not a server
  // object — routing them through printServerLine would render a misleading
  // "(unnamed) [?] (enabled)" line implying the server still exists. Print just
  // the id instead.
  if (data && typeof data === "object" && (data as Record<string, unknown>).removed === true) {
    const id = (data as Record<string, unknown>).id;
    console.log(`${label}: ${id !== undefined ? String(id) : ""}`.trimEnd());
    return;
  }

  if (label.startsWith("Added") || label.startsWith("Removed") || label.includes("MCP server")) {
    console.log(`${label}:`);
    printServerLine(data);
    return;
  }

  console.log(`${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

export function printServerLine(item: unknown): void {
  if (!item || typeof item !== "object") {
    console.log(`  ${JSON.stringify(item)}`);
    return;
  }
  const s = item as Record<string, unknown>;
  const enabled = s.enabled === false ? "disabled" : "enabled";
  const target = s.url ?? s.command ?? "";
  const builtin = s.builtin ? " [builtin]" : "";
  console.log(
    `  - ${String(s.name ?? "(unnamed)")} [${String(s.transport ?? "?")}] (${enabled})${builtin}` +
      `\n      id: ${String(s.id ?? "?")}` +
      (target ? `\n      ${s.url ? "url" : "command"}: ${String(target)}` : ""),
  );
}
