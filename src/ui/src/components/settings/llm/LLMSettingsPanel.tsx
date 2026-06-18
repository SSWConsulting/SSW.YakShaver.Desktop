import { Brain } from "lucide-react";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { LanguageModelSetting } from "./LanguageModelSetting";
import { TranscriptionModelSetting } from "./TranscriptionModelSetting";

interface LLMSettingsPanelProps {
  isActive: boolean;
}

export function LLMSettingsPanel({ isActive }: LLMSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Brain}
        title="Model Settings"
        description="Configure provider API keys for language and transcription models."
      />

      <LanguageModelSetting isActive={isActive} />
      <TranscriptionModelSetting isActive={isActive} />
    </div>
  );
}
