import { z } from "zod";

/** Stable output of ANALYZING_TRANSCRIPT and the content passed into backlog orchestration. */
export const AnalyzedTranscriptSchema = z.object({
  title: z.string().trim().min(1).max(90),
  taskType: z.string(),
  detectedLanguage: z.string(),
  formattedContent: z.string(),
  mentionedEntities: z.array(z.string()),
  contextKeywords: z.array(z.string()),
  uncertainTerms: z.array(z.string()),
});

export type AnalyzedTranscript = z.infer<typeof AnalyzedTranscriptSchema>;

export function readAnalyzedTranscript(serialized: string): AnalyzedTranscript | undefined {
  try {
    return AnalyzedTranscriptSchema.parse(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}
