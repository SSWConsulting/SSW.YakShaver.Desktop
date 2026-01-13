import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  Output,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";
import { BrowserWindow } from "electron";
import type { ZodType, z } from "zod";
import { LLM_PROVIDER_CONFIGS } from "../../../shared/llm/llm-providers";
import type { LLMConfig } from "../../../shared/types/llm";
import type { HealthStatusInfo } from "../../types";
import { formatErrorMessage } from "../../utils/error-utils";
import { LlmStorage } from "../storage/llm-storage";

type StepType =
  | "start"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "final_result"
  | "tool_approval_required"
  | "tool_denied";

interface MCPStep {
  type: StepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  timestamp?: number;
}

function sendStepEvent(event: MCPStep): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("mcp:step-update", event);
    }
  }
}

export class LanguageModelProvider {
  private static instance: LanguageModelProvider | null = null;
  private languageModel: LanguageModel | null = null;

  private constructor() {}

  static async getInstance(): Promise<LanguageModelProvider> {
    if (!LanguageModelProvider.instance) {
      LanguageModelProvider.instance = new LanguageModelProvider();
    }
    await LanguageModelProvider.instance.updateLanguageModel();
    return LanguageModelProvider.instance;
  }

  public async updateLanguageModel(): Promise<void> {
    const llmConfig: LLMConfig =
      (await LlmStorage.getInstance().getLLMConfig())?.languageModel ??
      (() => {
        throw new Error("[LanguageModelProvider]: LLM language configuration not found");
      })();

    const config = LLM_PROVIDER_CONFIGS[llmConfig.provider];
    if (!config || !config.defaultLanguageModel) {
      throw new Error(`[LanguageModelProvider]: Unsupported LLM provider: ${llmConfig.provider}`);
    }

    console.log(`[LanguageModelProvider]: updateLanguageModel - configuring ${llmConfig.provider}`);

    const client = config.factory({ apiKey: llmConfig.apiKey });
    const modelName = llmConfig.model ?? config.defaultLanguageModel;
    console.log(`[LanguageModelProvider]: Using model: ${modelName}`);
    this.languageModel = client.languageModel(modelName);
  }

  public async generateText(messages: ModelMessage[]): Promise<string> {
    if (!this.languageModel) {
      throw new Error("[LanguageModelProvider]: LLM client not initialized");
    }

    const { text } = await generateText({
      model: this.languageModel,
      messages: messages,
    });
    return text;
  }

  public async generateTextWithTools(
    messages: ModelMessage[],
    tools?: ToolSet,
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    if (!this.languageModel) {
      throw new Error("[LanguageModelProvider]: LLM client not initialized");
    }

    // remove 'execute' functions from tools before passing to generateText to prevent ai sdk auto execute the tool
    const sanitizedTools = tools
      ? Object.fromEntries(
          Object.entries(tools).map(([name, { execute, ...rest }]) => [name, rest]),
        )
      : undefined;

    const response = await generateText({
      model: this.languageModel,
      messages: messages,
      tools: sanitizedTools,
    });

    return response;
  }

  public async generateObject<T extends ZodType>(
    prompt: string,
    schema: T,
    systemPrompt?: string,
  ): Promise<z.infer<T>> {
    try {
      if (!this.languageModel) {
        throw new Error("[LanguageModelProvider]: LLM client not initialized");
      }
      const { output } = await generateText({
        system: systemPrompt,
        model: this.languageModel,
        output: Output.object({ schema }),
        prompt: prompt,
      });
      return schema.parse(output);
    } catch (error) {
      throw new Error(
        `[LanguageModelProvider]: Failed to generate object matching schema. Prompt: "${prompt}". Schema: ${
          schema?.toString?.() || "[unknown schema]"
        }. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async generateJson(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      if (!this.languageModel) {
        throw new Error("[LanguageModelProvider]: LLM client not initialized");
      }
      const { output } = await generateText({
        system: systemPrompt,
        model: this.languageModel,
        output: Output.json(),
        prompt: prompt,
      });
      if (!output) {
        throw new Error("No output received from LLM when generating JSON");
      }
      return JSON.stringify(output);
    } catch (error) {
      throw new Error(
        `[LanguageModelProvider]: Failed to generate object matching schema. Prompt: "${prompt}". Original error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  public async sendMessage(
    message: ModelMessage[],
    tools: ToolSet,
  ): Promise<Awaited<ReturnType<typeof streamText>>> {
    if (!this.languageModel) {
      throw new Error("[LanguageModelProvider]: LLM client not initialized");
    }

    try {
      return streamText({
        model: this.languageModel,
        tools,
        messages: message,
        stopWhen: stepCountIs(50),
        onFinish: (result) => sendStepEvent({ type: "final_result", message: result.finishReason }),
        onChunk: ({ chunk }) => {
          switch (chunk.type) {
            case "tool-call":
              // send an event to your orchestrator UI: "Calling tool X …"
              sendStepEvent({ type: "tool_call", toolName: chunk.toolName, args: chunk.input });
              break;
            case "tool-result":
              // show the result once the tool returns
              sendStepEvent({
                type: "tool_result",
                toolName: chunk.toolName,
                result: chunk.output,
              });
              break;
          }
        },
      });
    } catch (error) {
      console.error("[LanguageModelProvider]: Error in sendMessage:", error);
      throw error;
    }
  }

  public async checkHealth(): Promise<HealthStatusInfo> {
    // Ensure the latest model configuration
    await this.updateLanguageModel();

    try {
      if (!this.languageModel) {
        return {
          isHealthy: false,
          error: "Language model not initialized",
        };
      }

      const messages: ModelMessage[] = [
        { role: "user", content: "what is your model name and version?" },
      ];

      const response = await this.generateText(messages);

      console.log("[LanguageModelProvider]: Health check response:", response);

      return {
        isHealthy: true,
        successMessage: `Healthy - Model: ${response}`,
      };
    } catch (err) {
      return {
        isHealthy: false,
        error: formatErrorMessage(err),
      };
    }
  }
}
