import { BaseModelKeyManager } from "./BaseModelKeyManager";

interface LanguageModelKeyManagerProps {
  isActive: boolean;
}

export function LanguageModelKeyManager({
  isActive,
}: LanguageModelKeyManagerProps) {
  return (
    <BaseModelKeyManager
      isActive={isActive}
      modelType="languageModel"
      title="Language API Settings"
      description="Set the LLM provider API key used by the language model"
    />
  );
}
