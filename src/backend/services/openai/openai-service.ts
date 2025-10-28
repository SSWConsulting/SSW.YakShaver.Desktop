// TODO: make this LLM Client generic and configurable via llm-config.json, so it supports different llms https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
import { createReadStream } from "node:fs";
import { AzureOpenAI, OpenAI } from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index";
import { LlmStorage, type LLMConfig } from "../storage/llm-storage";

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
      } else {
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
      throw new Error(
        "LLM is not configured. Please configure it via LLM Settings."
      );
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
      throw new Error(
        "LLM is not configured. Please configure it via LLM Settings."
      );
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
      throw new Error(
        "LLM is not configured. Please configure it via LLM Settings."
      );
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
      throw new Error(
        "LLM is not configured. Please configure it via LLM Settings."
      );
    }
    if (cfg.provider === "openai") {
      return "gpt-4o";
    }
    if (!cfg.deployment) {
      throw new Error(
        "Azure OpenAI is configured but AZURE_OPENAI_DEPLOYMENT is missing. Please set the deployment name."
      );
    }
    return cfg.deployment;
  }

  async checkHealth(): Promise<{
    healthy: boolean;
    error?: string;
    model?: string;
  }> {
    try {
      await this.ensureClient();
      if (!this.client) {
        return {
          healthy: false,
          error: "LLM client not configured",
        };
      }

      const model = await this.getModel();
      await this.client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      });

      return {
        healthy: true,
        model,
      };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
