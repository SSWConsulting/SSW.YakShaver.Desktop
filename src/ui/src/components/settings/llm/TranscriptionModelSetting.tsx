import { BaseModelKeyManager } from "./BaseModelKeyManager";

interface TranscriptionModelSettingProps {
  isActive: boolean;
}

export function TranscriptionModelSetting({ isActive }: TranscriptionModelSettingProps) {
  return (
    <BaseModelKeyManager
      isActive={isActive}
      modelType="transcriptionModel"
      title="Transcription Model"
      description="Transcription model will be used to convert audio input into text."
    />
  );
}
