import type { LanguageModelProvider } from "../mcp/language-model-provider";

/**
 * System prompt for the transcript optimization step.
 *
 * The goal is to fix spelling errors and minor grammar issues (such as missing
 * articles) that are commonly introduced by automatic speech-to-text systems,
 * while preserving the speaker's original meaning, intent, and wording as
 * closely as possible.
 *
 * The error class we're targeting is homophone/mishearing confusion — the STT
 * engine substitutes a real, correctly-spelled word (or short phrase) that sounds
 * similar to what was actually said, producing a grammatically plausible but
 * contextually wrong result. We deliberately avoid a literal example pair in this
 * prompt (e.g. a specific word standing in for another specific word): giving the
 * LLM a verbatim pattern to match risks it "correcting" every legitimate occurrence
 * of that word elsewhere in the transcript, rather than only genuine STT artefacts.
 */
export const OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT = `You are a transcript editor specializing in correcting automatic speech-to-text (STT) output.

Your task is to fix spelling mistakes and minor grammar issues — in particular missing articles (a, an, the) and word confusions introduced by the STT engine — while preserving the speaker's original meaning, intent, and phrasing as closely as possible.

Rules:
- Correct clear STT errors: words or short phrases that were mis-transcribed as a different, similar-sounding real word (homophone/mishearing confusion), missing articles, obvious misspellings.
- Only correct a word when the surrounding context makes it clear it is an STT mistake — do not change a word just because it superficially resembles a commonly-confused term; the same word can be correct in one place and wrong in another.
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
 * Returns the corrected transcript text, covering the FULL length of `rawTranscript`.
 * Guards against unbounded LLM cost/latency by only sending the first
 * `MAX_OPTIMIZE_INPUT_LENGTH` characters to the LLM — but when the raw transcript
 * exceeds that cap, the untouched remainder (beyond the cap) is appended verbatim
 * to the optimized prefix so no user content is ever dropped from the pipeline; only
 * the tail's spelling/grammar pass is skipped, not the tail itself. A warning is
 * logged when this partial-optimization path is taken.
 *
 * Also guards against LLM over-rewriting/hallucination by falling back to the raw
 * transcript (in full, untruncated) when the optimized output's length deviates too
 * far from the (possibly truncated) input sent to the LLM.
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

  const isTruncated = rawTranscript.length > MAX_OPTIMIZE_INPUT_LENGTH;
  const inputTranscript = isTruncated
    ? rawTranscript.slice(0, MAX_OPTIMIZE_INPUT_LENGTH)
    : rawTranscript;
  const remainder = isTruncated ? rawTranscript.slice(MAX_OPTIMIZE_INPUT_LENGTH) : "";

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

  if (isTruncated) {
    console.warn(
      `[optimizeTranscript] Input (${rawTranscript.length} chars) exceeded ` +
        `MAX_OPTIMIZE_INPUT_LENGTH (${MAX_OPTIMIZE_INPUT_LENGTH}); only the first ` +
        `${MAX_OPTIMIZE_INPUT_LENGTH} chars were sent for optimization. Appending the ` +
        "untouched remainder unmodified so no content is lost (partial optimization).",
    );
    return trimmed + remainder;
  }

  return trimmed;
}
