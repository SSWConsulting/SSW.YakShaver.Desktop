/**
 * The JSON envelope the orchestrator's final message is formatted into.
 *
 * Parsed by BOTH the renderer (to persist the shave status + the "View work item" link) and the
 * backend (to find the work item whose title the workflow reconciles against), so the fence
 * stripping and the field names live in exactly one place. A backend that failed to parse what
 * the UI parses would silently skip reconciliation instead of failing visibly.
 */
export interface FinalOutput {
  Status?: string;
  Repository?: string;
  Title?: string;
  URL?: string;
  Description?: string;
  Labels?: string[];
}

/**
 * Throws when the payload is not the expected JSON envelope — callers decide how loud that is.
 * The renderer surfaces it (it blocks persisting the shave record); the backend swallows it
 * (title reconciliation is best-effort and must never fail an already-filed work item).
 */
export function parseFinalOutput(finalOutput: string): FinalOutput {
  const cleanOutput = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleanOutput) as FinalOutput;
}

/**
 * The work item link the user clicks in "View work item" — and the fallback input to title
 * reconciliation. Returns undefined rather than throwing: a missing link just means there is
 * nothing to reconcile against, which is the same outcome as before reconciliation existed.
 */
export function readWorkItemUrl(finalOutput: string | undefined): string | undefined {
  return readFinalOutputField(finalOutput, "URL");
}

/**
 * The title the orchestrator REPORTS it filed. Self-reported and therefore not authoritative — but
 * it is what the shave title has always fallen back to, and it beats showing the recording's file
 * name when the work item itself cannot be read.
 */
export function readReportedTitle(finalOutput: string | undefined): string | undefined {
  return readFinalOutputField(finalOutput, "Title");
}

function readFinalOutputField(
  finalOutput: string | undefined,
  field: "URL" | "Title",
): string | undefined {
  if (!finalOutput) {
    return undefined;
  }

  try {
    return parseFinalOutput(finalOutput)[field]?.trim() || undefined;
  } catch {
    return undefined;
  }
}
