import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText, stepCountIs, streamText } from "ai";
import type { GenerateObjectResult, LanguageModel, ModelMessage, ToolSet } from "ai";
import type { ZodTypeAny } from "zod";
import { BrowserWindow } from "electron";
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

export class LLMClientProvider {
  public static llmClient: LLMClientProvider | null = null;
  private static languageModel: LanguageModel;

  private constructor() {}

  static async getInstanceAsync(): Promise<LLMClientProvider | null> {
    if (LLMClientProvider.llmClient) {
      return LLMClientProvider.llmClient;
    }

    await LLMClientProvider.updateLanguageModelAsync();
    return LLMClientProvider.llmClient;
  }

  // Get the latest language model configuration
  public static async updateLanguageModelAsync(): Promise<void> {
    if (!LLMClientProvider.llmClient) {
      LLMClientProvider.llmClient = new LLMClientProvider();
    }
    // retrieve LLM configuration
    const llmConfig =
      (await LlmStorage.getInstance().getLLMConfig()) ??
      (() => {
        throw new Error("[LLMClientProvider]: LLM configuration not found");
      })();

    if (llmConfig.provider === "deepseek") {
      console.log("[LLMClientProvider]: updateLanguageModelAsync - configuring DeepSeek");
      const deepseek = createDeepSeek({
        apiKey: llmConfig.apiKey,
      });
      LLMClientProvider.languageModel = deepseek(llmConfig.model ?? "deepseek-chat");
    }

    if (llmConfig.provider === "openai") {
      console.log("[LLMClientProvider]: updateLanguageModelAsync - configuring OpenAI");
      const openai = createOpenAI({
        apiKey: llmConfig.apiKey,
      });
      LLMClientProvider.languageModel = openai(llmConfig.model ?? "gpt-5-mini");
    }

    if (llmConfig.provider === "azure") {
      // Azure OpenAI configuration
    }
  }

  public async generateText(messages: ModelMessage[]): Promise<string> {
    if (!LLMClientProvider.languageModel) {
      throw new Error("[LLMClientProvider]: LLM client not initialized");
    }

    const { text } = await generateText({
      model: LLMClientProvider.languageModel,
      messages: messages,
    });
    return text;
  }

  public async generateTextWithTools(
    messages: ModelMessage[],
    tools?: ToolSet,
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    if (!LLMClientProvider.languageModel) {
      throw new Error("[LLMClientProvider]: LLM client not initialized");
    }

    // remove 'execute' functions from tools before passing to generateText to prevent ai sdk auto execute the tool
    const sanitizedTools = tools
      ? Object.fromEntries(
          Object.entries(tools).map(([name, { execute, ...rest }]) => [name, rest]),
        )
      : undefined;

    const response = await generateText({
      model: LLMClientProvider.languageModel,
      messages: messages,
      tools: sanitizedTools,
    });

    return response;
  }

  public async generateObject(
    message: string,
    schema: ZodTypeAny,
  ): Promise<GenerateObjectResult<unknown>> {
    try {
      const response = await generateObject({
        model: LLMClientProvider.languageModel,
        schema: schema,
        prompt: message,
      });
      return response;
    } catch (error) {
      throw new Error(
        `[LLMClientProvider]: Failed to generate object matching schema. Message: "${message}". Schema: ${schema?.toString?.() || '[unknown schema]'}. Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async sendMessage(
    message: ModelMessage[],
    tools: ToolSet,
  ): Promise<Awaited<ReturnType<typeof streamText>>> {
    if (!LLMClientProvider.languageModel) {
      throw new Error("[LLMClientProvider]: LLM client not initialized");
    }

    try {
      return streamText({
        model: LLMClientProvider.languageModel,
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
      console.error("[LLMClientProvider]: Error in sendMessage:", error);
      throw error;
    }
  }

  public static async checkHealthAsync(): Promise<HealthStatusInfo> {
    // Ensure the latest model configuration
    await LLMClientProvider.updateLanguageModelAsync();

    try {
      const providerInstance = await LLMClientProvider.getInstanceAsync();
      if (!providerInstance) {
        return {
          isHealthy: false,
          error: "LLM client provider not initialized",
        };
      }

      const messages: ModelMessage[] = [
        { role: "user", content: "what is your model name and version?" },
      ];

      const response = await providerInstance.generateText(messages);

      console.log("[LLMClientProvider]: Health check response:", response);

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
