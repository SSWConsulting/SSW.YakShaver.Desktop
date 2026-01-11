import { BaseModelKeyManager } from "./BaseModelKeyManager";

interface TranscriptionModelKeyManagerProps {
  isActive: boolean;
}

export function TranscriptionModelKeyManager({
  isActive,
}: TranscriptionModelKeyManagerProps) {
  return (
    <BaseModelKeyManager
      isActive={isActive}
      modelType="transcriptionModel"
      title="Transcription API Settings"
      description="Set the LLM provider API key used by the transcription service"
    />
  );
}
