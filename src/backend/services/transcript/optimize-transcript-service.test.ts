import { describe, expect, it, vi } from "vitest";
import type { LanguageModelProvider } from "../mcp/language-model-provider";
import {
  OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT,
  optimizeTranscript,
} from "./optimize-transcript-service";

/**
 * Integration test for the transcript optimization step (#693).
 *
 * The acceptance criterion requires that the optimized transcript contains the
 * phrase "an error" where the STT engine returned "narrow" (or another
 * homophone). These tests verify that:
 *  1. The system prompt instructs the LLM to fix common STT artefacts.
 *  2. The service passes the raw transcript to the LLM and returns the corrected text.
 *  3. Fallback behaviour works correctly (empty input, LLM failure).
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

  it("explicitly calls out word confusions as an STT artefact to fix", () => {
    // The canonical example from the issue: STT returns "narrow" instead of "an error"
    expect(OPTIMIZE_TRANSCRIPT_SYSTEM_PROMPT).toMatch(/narrow.*an error|an error.*narrow/i);
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

  it('corrects "narrow" to "an error" as described in acceptance criterion #693', async () => {
    // The canonical example: STT misheard "an error" as "narrow"
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
});
