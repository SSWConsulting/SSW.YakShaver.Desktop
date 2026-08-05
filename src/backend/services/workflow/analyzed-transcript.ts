import { z } from "zod";

const MAX_SHAVE_TITLE_LENGTH = 90;

const analyzedTranscriptFields = {
  taskType: z.string(),
  detectedLanguage: z.string(),
  formattedContent: z.string(),
  mentionedEntities: z.array(z.string()),
  contextKeywords: z.array(z.string()),
  uncertainTerms: z.array(z.string()),
};

/** LLM-facing schema: validate shape, then enforce the UI length limit deterministically in code. */
export const AnalyzedTranscriptGenerationSchema = z.object({
  title: z.string().trim().min(1),
  ...analyzedTranscriptFields,
});

/** Stable output of ANALYZING_TRANSCRIPT and the content passed into backlog orchestration. */
export const AnalyzedTranscriptSchema = z.object({
  ...AnalyzedTranscriptGenerationSchema.shape,
  title: z.string().trim().min(1).max(MAX_SHAVE_TITLE_LENGTH),
});

export type AnalyzedTranscript = z.infer<typeof AnalyzedTranscriptSchema>;

/**
 * Truncates to the UI limit without splitting a surrogate pair. Iterating code points alone is NOT
 * enough: `.max()` counts UTF-16 code units, so 90 code points of emoji-prefixed text is 91+ units
 * and would throw the stage this normalisation exists to keep alive. House style puts an emoji in
 * front of every title (#488), so that is the common case, not an exotic one. Budgeting each code
 * point against the running `length` satisfies both units at once.
 */
function truncateShaveTitle(value: string): string {
  let title = "";
  for (const char of value.trim()) {
    if (title.length + char.length > MAX_SHAVE_TITLE_LENGTH) {
      break;
    }
    title += char;
  }
  return title;
}

export function normalizeAnalyzedTranscript(
  generated: z.infer<typeof AnalyzedTranscriptGenerationSchema>,
): AnalyzedTranscript {
  return AnalyzedTranscriptSchema.parse({
    ...generated,
    title: truncateShaveTitle(generated.title),
  });
}

export function readAnalyzedTranscript(serialized: string): AnalyzedTranscript | undefined {
  try {
    return AnalyzedTranscriptSchema.parse(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}
