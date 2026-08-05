import { z } from "zod";

/**
 * The JSON envelope the orchestrator's final message is formatted into.
 *
 * Parsed by BOTH the renderer (to persist the shave status + the "View work item" link) and the
 * backend (to find the work item whose title the workflow reconciles against), so the fence
 * stripping and the field names live in exactly one place. A backend that failed to parse what
 * the UI parses would silently skip reconciliation instead of failing visibly.
 *
 * The payload is model-produced, so every field is validated rather than asserted. A field whose
 * type is wrong is dropped (`.catch(undefined)`) instead of poisoning the whole envelope: a
 * numeric `URL` must not reach the database as one, but it also must not cost us the `Status`
 * sitting next to it. A payload that is not an object at all still throws, which is what the
 * renderer relies on to report an unusable final output.
 */
const optionalText = z.string().trim().optional().catch(undefined);

export const FinalOutputSchema = z.object({
  Status: optionalText,
  Repository: optionalText,
  Title: optionalText,
  URL: optionalText,
  Description: optionalText,
  Labels: z.array(z.string()).optional().catch(undefined),
});

export type FinalOutput = z.infer<typeof FinalOutputSchema>;

/**
 * Extract the JSON body from whatever the model wrapped it in.
 *
 * #888: this CAPTURES the fenced block rather than deleting the fence markers. A global
 * substring-strip mutates the payload — it removed the backticks from inside a `Description`
 * value — and is blind to an uppercase ```JSON fence or to prose around the block. Greedy to the
 * LAST fence, so a value that itself contains a ``` survives instead of being truncated.
 * No fence at all -> parse the raw string.
 */
function extractJsonBody(finalOutput: string): string {
  const fenced = finalOutput.match(/```(?:json)?\s*([\s\S]*)```/i);
  return (fenced ? fenced[1] : finalOutput).trim();
}

/**
 * Throws when the payload is not the expected JSON envelope — callers decide how loud that is.
 * The renderer surfaces it (it blocks persisting the shave record); the backend swallows it
 * (title reconciliation is best-effort and must never fail an already-filed work item).
 */
export function parseFinalOutput(finalOutput: string): FinalOutput {
  return FinalOutputSchema.parse(JSON.parse(extractJsonBody(finalOutput)));
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
    return parseFinalOutput(finalOutput)[field] || undefined;
  } catch {
    return undefined;
  }
}
