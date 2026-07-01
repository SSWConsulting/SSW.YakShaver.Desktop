import type { LanguageModelProvider } from "../mcp/language-model-provider";

/**
 * System prompt for the transcript optimization step.
 *
 * The goal is to fix spelling errors and minor grammar issues (such as missing
 * articles) that are commonly introduced by automatic speech-to-text systems,
 * while preserving the speaker's original meaning, intent, and wording as
 * closely as possible.
 *
 * Example: STT may return "narrow" when the speaker said "an error" — this
 * step corrects such artefacts.
 */
export const OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT = `You are a transcript editor specializing in correcting automatic speech-to-text (STT) output.

Your task is to fix spelling mistakes and minor grammar issues — in particular missing articles (a, an, the) and word confusions introduced by the STT engine — while preserving the speaker's original meaning, intent, and phrasing as closely as possible.

Rules:
- Correct clear STT errors: misheard words (e.g. "narrow" → "an error"), missing articles, obvious misspellings.
- Do NOT paraphrase, summarise, restructure, or rewrite content.
- Do NOT add, remove, or change any factual information.
- Do NOT alter proper nouns, brand names, technical terms, or URLs unless they are obviously garbled.
- Preserve the speaker's tone and natural speech patterns.
- Output ONLY the corrected transcript text — no commentary, no explanations, no markdown formatting.`;

/**
 * Upper bound (in characters) on the transcript text sent to the LLM for optimization.
 * Transcripts longer than this are truncated before the call so a very long recording
 * can't produce an unbounded prompt size/cost/latency. This is a coarse guard, not a
 * token-accurate limit.
 */
export const MAX_OPTIMIZE_INPUT_LENGTH = 20_000;

/**
 * Maximum allowed relative length difference between the optimized output and the raw
 * input before the optimization is treated as unsafe and discarded in favour of the raw
 * transcript. Spelling/grammar fixes should barely change the overall length; a much
 * shorter or much longer result is a signal the LLM paraphrased, summarised, or otherwise
 * over-rewrote the transcript rather than just correcting STT artefacts.
 */
const MAX_LENGTH_DELTA_RATIO = 0.4;

function exceedsLengthDelta(original: string, optimized: string): boolean {
  if (original.length === 0) {
    return false;
  }
  const delta = Math.abs(optimized.length - original.length) / original.length;
  return delta > MAX_LENGTH_DELTA_RATIO;
}

/**
 * Optimizes a raw STT transcript by correcting spelling errors and minor
 * grammar issues (e.g. missing articles, misheard words) using an LLM.
 *
 * Returns the corrected transcript text. Guards against unbounded input size by
 * truncating very long transcripts before sending them to the LLM, and against
 * LLM over-rewriting/hallucination by falling back to the raw transcript when the
 * optimized output's length deviates too far from the input's.
 *
 * Does NOT catch errors from the underlying LLM call — if `generateText` throws,
 * the error propagates to the caller, which is responsible for falling back to the
 * raw transcript (see `process-video-handlers.ts`'s OPTIMIZING_TRANSCRIPT stage).
 */
export async function optimizeTranscript(
  rawTranscript: string,
  languageModelProvider: LanguageModelProvider,
): Promise<string> {
  if (!rawTranscript.trim()) {
    return rawTranscript;
  }

  const inputTranscript =
    rawTranscript.length > MAX_OPTIMIZE_INPUT_LENGTH
      ? rawTranscript.slice(0, MAX_OPTIMIZE_INPUT_LENGTH)
      : rawTranscript;

  const userPrompt = `Please correct the following auto-generated transcript:\n\n${inputTranscript}`;

  const optimized = await languageModelProvider.generateText([
    { role: "system" as const, content: OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ]);

  const trimmed = optimized.trim();
  if (!trimmed) {
    return rawTranscript;
  }

  if (exceedsLengthDelta(inputTranscript, trimmed)) {
    console.warn(
      "[optimizeTranscript] Optimized transcript length deviates too far from the input " +
        "(possible over-rewrite/hallucination); falling back to the raw transcript.",
    );
    return rawTranscript;
  }

  return trimmed;
}
