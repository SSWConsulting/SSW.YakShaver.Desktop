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
 * Optimizes a raw STT transcript by correcting spelling errors and minor
 * grammar issues (e.g. missing articles, misheard words) using an LLM.
 *
 * Returns the corrected transcript text. If the optimization call fails, the
 * original transcript is returned unchanged so the workflow is never blocked.
 */
export async function optimizeTranscript(
  rawTranscript: string,
  languageModelProvider: LanguageModelProvider,
): Promise<string> {
  if (!rawTranscript.trim()) {
    return rawTranscript;
  }

  const userPrompt = `Please correct the following auto-generated transcript:\n\n${rawTranscript}`;

  const optimized = await languageModelProvider.generateText([
    { role: "system" as const, content: OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ]);

  return optimized.trim() || rawTranscript;
}
