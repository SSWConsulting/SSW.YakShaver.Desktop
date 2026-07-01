import { describe, expect, it, vi } from "vitest";
import type { LanguageModelProvider } from "../mcp/language-model-provider";
import {
  MAX_OPTIMIZE_INPUT_LENGTH,
  OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT,
  optimizeTranscript,
} from "./optimize-transcript-service";

/**
 * Unit tests for the transcript optimization step (#693).
 *
 * These tests cover plumbing and safety-guard behaviour with a mocked LLM — they do
 * NOT verify that a real LLM call actually performs STT homophone/mishearing-style
 * corrections (e.g. "narrow" -> "an error") described in the acceptance criterion
 * (that quality depends on the live model and prompt, which isn't something a unit
 * test with a mocked provider can prove). What is verified here:
 *  1. The system prompt instructs the LLM to fix common STT artefacts, described as
 *     an abstract error class (not a literal word-pair, to avoid the LLM pattern-matching
 *     on a specific real word and over-correcting legitimate uses of it elsewhere).
 *  2. The service passes the raw transcript to the LLM and returns whatever corrected
 *     text the (mocked) LLM returns.
 *  3. Fallback and safety-guard behaviour: empty input, LLM failure, oversized input
 *     truncation (including that the untouched remainder beyond the cap is preserved
 *     in full, not dropped), and rejecting outputs that deviate too far in length from
 *     the (possibly truncated) input.
 */

describe("OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT (#693)", () => {
  it("instructs the LLM to fix STT spelling errors and missing articles", () => {
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(/spelling/);
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(/article/);
  });

  it("instructs the LLM to preserve original meaning", () => {
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(/preserv/);
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(/meaning/);
  });

  it("describes homophone/mishearing confusion as an STT artefact to fix, without a literal word-pair example", () => {
    // The error class from the issue (STT substituting a similar-sounding real word, e.g.
    // "narrow" for "an error") should be described abstractly, not as a literal example pair —
    // a verbatim example risks the LLM pattern-matching on that specific word and over-correcting
    // legitimate uses of it elsewhere in the transcript.
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /similar-sounding|homophone|mishear/,
    );
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT).not.toMatch(/narrow.*an error|an error.*narrow/i);
  });

  it("instructs the LLM to output ONLY the corrected transcript text", () => {
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT.toLowerCase()).toMatch(/output only/i);
  });
});

describe("optimizeTranscript (#693)", () => {
  function makeMockProvider(returnText: string): LanguageModelProvider {
    return {
      generateText: vi.fn().mockResolvedValue(returnText),
    } as unknown as LanguageModelProvider;
  }

  it("returns the corrected text from the LLM", async () => {
    const rawTranscript = "I found narrow in the code.";
    const corrected = "I found an error in the code.";
    const provider = makeMockProvider(corrected);

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(corrected);
  });

  it('passes through a "narrow" -> "an error" style correction from the (mocked) LLM (#693 plumbing check)', async () => {
    // Plumbing-only: this proves optimizeTranscript() returns whatever the LLM returns
    // verbatim (subject to the length-delta guard below); it does NOT prove a real LLM
    // performs this correction — that depends on the live model, not this mock.
    const rawTranscript = "There is narrow in the transcription returned narrow instead.";
    const corrected = "There is an error in the transcription returned an error instead.";
    const provider = makeMockProvider(corrected);

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toContain("an error");
  });

  it("passes the raw transcript to the LLM inside the user message", async () => {
    const rawTranscript = "This is the raw transcript text.";
    const provider = makeMockProvider("This is the raw transcript text.");

    await optimizeTranscript(rawTranscript, provider);

    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    const messages = generateText.mock.calls[0][0] as { role: string; content: string }[];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain(rawTranscript);
  });

  it("passes the system prompt to the LLM", async () => {
    const provider = makeMockProvider("corrected.");

    await optimizeTranscript("some transcript", provider);

    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    const messages = generateText.mock.calls[0][0] as { role: string; content: string }[];
    const systemMessage = messages.find((m) => m.role === "system");
    expect(systemMessage?.content).toBe(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT);
  });

  it("returns the original transcript unchanged when the input is empty", async () => {
    const provider = makeMockProvider("");

    const result = await optimizeTranscript("", provider);

    expect(result).toBe("");
    // The LLM should NOT be called for empty input
    expect(provider.generateText as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("returns the original transcript unchanged when the input is whitespace-only", async () => {
    const provider = makeMockProvider("");

    const result = await optimizeTranscript("   \n  ", provider);

    expect(result).toBe("   \n  ");
    expect(provider.generateText as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("returns the original transcript when the LLM returns empty text", async () => {
    const rawTranscript = "Some transcript.";
    const provider = makeMockProvider("   "); // LLM returns whitespace-only

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(rawTranscript);
  });

  it("propagates errors thrown by the LLM so the caller can implement fallback", async () => {
    const provider = {
      generateText: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    } as unknown as LanguageModelProvider;

    await expect(optimizeTranscript("some transcript", provider)).rejects.toThrow(
      "LLM unavailable",
    );
  });

  it("truncates the input sent to the LLM when it exceeds the max input length", async () => {
    const rawTranscript = "a".repeat(MAX_OPTIMIZE_INPUT_LENGTH + 5_000);
    const provider = makeMockProvider("corrected.");

    await optimizeTranscript(rawTranscript, provider);

    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    const messages = generateText.mock.calls[0][0] as { role: string; content: string }[];
    const userMessage = messages.find((m) => m.role === "user");
    // The prompt prefix text plus at most MAX_OPTIMIZE_INPUT_LENGTH characters of transcript.
    expect(userMessage?.content.length).toBeLessThan(rawTranscript.length);
  });

  it("does NOT drop content beyond the max input length — the untouched remainder is appended to the result", async () => {
    // Word-like content (with whitespace near the cap) rather than one giant unbroken run of
    // a single character, so this exercises the normal whitespace-boundary truncation path
    // rather than the rare no-boundary-found fallback (covered separately above).
    const optimizedPrefix = "bbb ".repeat(Math.ceil(MAX_OPTIMIZE_INPUT_LENGTH / 4));
    const remainder = "ccc ".repeat(1_250);
    const rawTranscript = "aaa ".repeat(Math.ceil(MAX_OPTIMIZE_INPUT_LENGTH / 4)) + remainder;
    // The mocked LLM "corrects" the (truncated) prefix it was sent, keeping length identical
    // so the length-delta guard doesn't reject it.
    const provider = makeMockProvider("");
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    generateText.mockImplementation(async () =>
      optimizedPrefix.slice(0, MAX_OPTIMIZE_INPUT_LENGTH),
    );

    const result = await optimizeTranscript(rawTranscript, provider);

    // Full original length must be represented in the output — nothing silently dropped.
    expect(result.length).toBe(rawTranscript.length);
    expect(result.endsWith(remainder)).toBe(true);
  });

  it("does not append a remainder when the transcript is within the max input length", async () => {
    const rawTranscript = "Short transcript within the limit.";
    const provider = makeMockProvider(rawTranscript);

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(rawTranscript);
  });

  it("falls back to the raw transcript when the optimized output is drastically shorter (possible over-summarisation)", async () => {
    const rawTranscript = "word ".repeat(200).trim();
    const provider = makeMockProvider("short.");

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(rawTranscript);
  });

  it("falls back to the raw transcript when the optimized output is drastically longer (possible hallucinated expansion)", async () => {
    const rawTranscript = "Short transcript.";
    const provider = makeMockProvider("word ".repeat(200).trim());

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(rawTranscript);
  });

  it("accepts an optimized output whose length is close to the input (normal spelling/grammar fix)", async () => {
    const rawTranscript = "I found narrow in the code.";
    const corrected = "I found an error in the code.";
    const provider = makeMockProvider(corrected);

    const result = await optimizeTranscript(rawTranscript, provider);

    expect(result).toBe(corrected);
  });

  it("truncates on a whitespace boundary instead of splitting a word at the cap", async () => {
    // Build a transcript where a long word straddles MAX_OPTIMIZE_INPUT_LENGTH: if truncation
    // were a hard character-index slice, this word would be split in half.
    const straddlingWord = "supercalifragilisticexpialidocious";
    const prefix = "word ".repeat(
      Math.ceil((MAX_OPTIMIZE_INPUT_LENGTH - straddlingWord.length / 2) / "word ".length),
    );
    const rawTranscript = `${prefix}${straddlingWord} more words after the boundary ${"tail ".repeat(200)}`;
    // Sanity check: the straddling word does actually straddle the hard cutoff.
    const hardCutIndex = MAX_OPTIMIZE_INPUT_LENGTH;
    expect(hardCutIndex).toBeGreaterThan(prefix.length);
    expect(hardCutIndex).toBeLessThan(prefix.length + straddlingWord.length);

    const provider = makeMockProvider("");
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    generateText.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const userMessage = messages.find((m) => m.role === "user");
      const sentTranscript = userMessage?.content.split("\n\n")[1] ?? "";
      // Echo back unchanged so we can inspect exactly what was sent to the LLM.
      return sentTranscript;
    });

    const result = await optimizeTranscript(rawTranscript, provider);

    // The straddling word must appear intact and exactly once in the final result — never
    // split into two fragments and never duplicated/fused with an adjacent word.
    const occurrences = result.split(straddlingWord).length - 1;
    expect(occurrences).toBe(1);
    expect(result).toContain(` ${straddlingWord} `);
  });

  it("falls back to a hard cut when no whitespace boundary exists near the cap", async () => {
    // One giant unbroken token with no whitespace anywhere near MAX_OPTIMIZE_INPUT_LENGTH.
    const rawTranscript = "a".repeat(MAX_OPTIMIZE_INPUT_LENGTH + 5_000);
    const provider = makeMockProvider("corrected.");

    await optimizeTranscript(rawTranscript, provider);

    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    const messages = generateText.mock.calls[0][0] as { role: string; content: string }[];
    const userMessage = messages.find((m) => m.role === "user");
    const sentTranscript = userMessage?.content.split("\n\n")[1] ?? "";
    expect(sentTranscript.length).toBe(MAX_OPTIMIZE_INPUT_LENGTH);
  });

  it("inserts a separator at the seam when the optimized prefix and remainder would otherwise fuse", async () => {
    const rawTranscript = `${"word ".repeat(4000)}tail-remainder-content`;
    const provider = makeMockProvider("");
    const generateText = provider.generateText as ReturnType<typeof vi.fn>;
    generateText.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const userMessage = messages.find((m) => m.role === "user");
      const sentTranscript = userMessage?.content.split("\n\n")[1] ?? "";
      // Simulate an LLM response that has been trimmed of trailing whitespace.
      return sentTranscript.trim();
    });

    const result = await optimizeTranscript(rawTranscript, provider);

    // The last word of the (trimmed) optimized prefix ("word") must not be glued directly onto
    // the remainder's first word ("tail-remainder-content") with no separator between them.
    expect(result).not.toMatch(/wordtail-remainder-content/);
    expect(result).toContain(" tail-remainder-content");
    expect(result.endsWith("tail-remainder-content")).toBe(true);
  });
});
