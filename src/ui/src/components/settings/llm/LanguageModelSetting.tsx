import { BaseModelKeyManager } from "./BaseModelKeyManager";

interface LanguageModelSettingProps {
  isActive: boolean;
}

export function LanguageModelSetting({ isActive }: LanguageModelSettingProps) {
  return (
    <BaseModelKeyManager
      isActive={isActive}
      modelType="languageModel"
      title="Language Model"
      description="Language model will be used to power YakShaver features"
    />
  );
}
