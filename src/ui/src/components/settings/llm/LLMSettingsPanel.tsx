import { LanguageModelSetting } from "./LanguageModelSetting";
import { TranscriptionModelSetting } from "./TranscriptionModelSetting";

interface LLMSettingsPanelProps {
  isActive: boolean;
}

export function LLMSettingsPanel({ isActive }: LLMSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Model Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure provider API keys for language and transcription models.
        </p>
      </div>

      <LanguageModelSetting isActive={isActive} />
      <TranscriptionModelSetting isActive={isActive} />
    </div>
  );
}
