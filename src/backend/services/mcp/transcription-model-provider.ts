import { readFile } from "node:fs/promises";
import type { TranscriptSegment } from "@shared/types/transcript";
import { type TranscriptionModel, experimental_transcribe as transcribe } from "ai";
import { LLM_PROVIDER_CONFIGS } from "../../../shared/llm/llm-providers";
import type { LLMConfig } from "../../../shared/types/llm";
import { LlmStorage } from "../storage/llm-storage";

export class TranscriptionModelProvider {
  private static instance: TranscriptionModelProvider | null = null;
  private transcriptionModel: TranscriptionModel | null = null;

  private constructor() {}

  static async getInstance(): Promise<TranscriptionModelProvider> {
    if (!TranscriptionModelProvider.instance) {
      TranscriptionModelProvider.instance = new TranscriptionModelProvider();
    }
    await TranscriptionModelProvider.instance.updateTranscriptionModel();
    return TranscriptionModelProvider.instance;
  }

  public async updateTranscriptionModel(): Promise<void> {
    // retrieve LLM configuration
    const llmConfig: LLMConfig =
      (await LlmStorage.getInstance().getLLMConfig())?.transcriptionModel ??
      (() => {
        throw new Error("[TranscriptionModelProvider]: LLM transcription configuration not found");
      })();

    const config = LLM_PROVIDER_CONFIGS[llmConfig.provider];
    if (!config || !config.defaultTranscriptionModel) {
      throw new Error(
        `[TranscriptionModelProvider]: Unsupported LLM provider: ${llmConfig.provider}`,
      );
    }

    console.log(
      `[TranscriptionModelProvider]: updateTranscriptionModel - configuring ${llmConfig.provider}`,
    );

    const client = config.factory({ apiKey: llmConfig.apiKey });
    const modelName = llmConfig.model ?? config.defaultTranscriptionModel;
    if (!modelName)
      throw new Error("[TranscriptionModelProvider]: No transcription model specified");
    const transcriptionModel = client.transcriptionModel?.(modelName);
    if (!transcriptionModel)
      throw new Error(
        `[TranscriptionModelProvider]: Transcription model ${modelName} could not be created`,
      );

    this.transcriptionModel = transcriptionModel;
  }

  public async transcribeAudio(filePath: string): Promise<TranscriptSegment[]> {
    if (!this.transcriptionModel) {
      throw new Error("[TranscriptionModelProvider]: LLM transcription client not initialized");
    }
    const res = await transcribe({
      model: this.transcriptionModel,
      audio: await readFile(filePath),
      providerOptions: {
        openai: {
          timestampGranularities: ["segment"],
        },
      },
    });
    if (res.segments.length === 0) {
      return [
        {
          text: res.text,
          startSecond: 0,
          endSecond: res.durationInSeconds || 0,
        },
      ];
    }
    return res.segments.map((segment) => ({
      text: segment.text,
      startSecond: segment.startSecond,
      endSecond: segment.endSecond,
    }));
  }
}
