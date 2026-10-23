import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../storage/llm-storage", () => ({
  LlmStorage: {
    getInstance: () => ({
      getLLMConfig: async () => ({
        languageModel: { provider: "openai", apiKey: "test-key", model: "test-model" },
      }),
    }),
  },
}));

const mockModel = new MockLanguageModelV4({
  doGenerate: {
    content: [{ type: "text", text: "model reply" }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  },
});

vi.mock("../../../shared/llm/llm-providers", () => ({
  LLM_PROVIDER_CONFIGS: {
    openai: {
      label: "OpenAI",
      defaultLanguageModel: "test-model",
      factory: () => ({ languageModel: () => mockModel }),
    },
  },
}));

import { LanguageModelProvider } from "./language-model-provider";

// The orchestrator and transcript optimiser send their app-authored prompts as system
// messages inside `messages`. AI SDK 7 rejects that unless explicitly allowed.
const messagesWithSystemPrompt: ModelMessage[] = [
  { role: "system", content: "You are YakShaver." },
  { role: "user", content: "video transcription: hello" },
];

describe("LanguageModelProvider system messages", () => {
  beforeEach(() => {
    mockModel.doGenerateCalls.length = 0;
  });

  it("generateText accepts system messages in messages", async () => {
    const provider = await LanguageModelProvider.getInstance();

    await expect(provider.generateText(messagesWithSystemPrompt)).resolves.toBe("model reply");
    expect(mockModel.doGenerateCalls[0]?.prompt[0]).toMatchObject({ role: "system" });
  });

  it("generateTextWithTools accepts system messages in messages", async () => {
    const provider = await LanguageModelProvider.getInstance();

    const response = await provider.generateTextWithTools(messagesWithSystemPrompt, {});

    expect(response.text).toBe("model reply");
    expect(mockModel.doGenerateCalls[0]?.prompt[0]).toMatchObject({ role: "system" });
  });
});
