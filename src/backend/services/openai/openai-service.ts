//
// TODO: Remove this class after separating transcribe from OpenAI service
//
import { createReadStream } from "node:fs";
import { OpenAI } from "openai";
import { ERROR_MESSAGES } from "../../constants/error-messages";
import { type LLMConfig, LlmStorage } from "../storage/llm-storage";

export class OpenAIService {
  private static instance: OpenAIService;
  private client: OpenAI | null = null;
  private configured = false;
  private storage = LlmStorage.getInstance();

  static getInstance() {
    OpenAIService.instance ??= new OpenAIService();
    return OpenAIService.instance;
  }

  private constructor() {
    this.client = null;
    this.configured = false;
  }

  private async ensureClient(): Promise<void> {
    if (this.configured && this.client) return;

    const llmCfg: LLMConfig | null = await this.storage.getLLMConfig();
    if (llmCfg) {
      if (llmCfg.provider === "openai") {
        this.client = new OpenAI({ apiKey: llmCfg.apiKey });
        this.configured = true;
        return;
      }
    }

    this.client = null;
    this.configured = false;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async transcribeAudio(filePath: string) {
    await this.ensureClient();
    if (!this.client) {
      throw new Error(ERROR_MESSAGES.LLM_NOT_CONFIGURED);
    }
    return this.client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-1",
      response_format: "vtt",
      prompt: "The name of this app is called YakShaver",
    });
  }
}
