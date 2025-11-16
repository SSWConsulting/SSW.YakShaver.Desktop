//
// TODO: Remove this class after separating transcribe from OpenAI service
//
import { createReadStream } from "node:fs";
import { AzureOpenAI, OpenAI } from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index";
import { ERROR_MESSAGES } from "../../constants/error-messages";
import type { HealthStatusInfo } from "../../types";
import { formatErrorMessage } from "../../utils/error-utils";
import { type LLMConfig, LlmStorage } from "../storage/llm-storage";

export class OpenAIService {
  private static instance: OpenAIService;
  private client: OpenAI | AzureOpenAI | null = null;
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

      if (llmCfg.provider === "azure") {
        const { apiKey, endpoint, version, deployment } = llmCfg;
        const options = { endpoint, apiKey, version, deployment };
        this.client = new AzureOpenAI(options);
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

  async sendMessage(
    message: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[] = []
  ): Promise<ChatCompletion> {
    await this.ensureClient();
    if (!this.configured || !this.client) {
      throw new Error(ERROR_MESSAGES.LLM_NOT_CONFIGURED);
    }
    const response = await this.client.chat.completions.create({
      model: await this.getModel(),
      messages: message,
      tools: tools,
    });
    return response;
  }

  async generateOutput(
    systemPrompt: string,
    userInput: string,
    options?: { jsonMode?: boolean }
  ): Promise<string> {
    await this.ensureClient();
    if (!this.configured || !this.client) {
      throw new Error(ERROR_MESSAGES.LLM_NOT_CONFIGURED);
    }

    const response = await this.client.chat.completions.create({
      model: await this.getModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
      ...(options?.jsonMode && { response_format: { type: "json_object" } }),
    });

    return response.choices[0]?.message?.content || "";
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

  // Allow dynamic updates from UI
  setOpenAIKey(apiKey: string) {
    this.client = new OpenAI({ apiKey });
    this.configured = true;
  }

  clearOpenAIClient() {
    this.client = null;
    this.configured = false;
  }

  setAzureConfig(
    apiKey: string,
    endpoint: string,
    version: string,
    deployment: string
  ) {
    this.client = new AzureOpenAI({
      apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      apiVersion: version,
      deployment: deployment,
    });
    this.configured = true;
  }

  private async getModel(): Promise<string> {
    const cfg = await this.storage.getLLMConfig();
    if (!cfg) {
      throw new Error(ERROR_MESSAGES.LLM_NOT_CONFIGURED);
    }
    if (cfg.provider === "openai") {
      return "gpt-4o";
    }

    if (cfg.provider === "azure") {
      if (!cfg.deployment) {
        throw new Error(ERROR_MESSAGES.AZURE_DEPLOYMENT_MISSING);
      }
      return cfg.deployment;
    }

    throw new Error(ERROR_MESSAGES.LLM_NOT_CONFIGURED);
  }
}
