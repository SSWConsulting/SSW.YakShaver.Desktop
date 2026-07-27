import { Settings2 } from "lucide-react";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { CloseBehaviorSetting } from "./CloseBehaviorSetting";
import { ExecutingTaskTimeoutSetting } from "./ExecutingTaskTimeoutSetting";
import { KeyMappingSetting } from "./KeyMappingSetting";
import { StartupSetting } from "./StartupSetting";
import { ToolApprovalSetting } from "./ToolApprovalSetting";

interface GeneralSettingsPanelProps {
  isActive: boolean;
}

export function GeneralSettingsPanel({ isActive }: GeneralSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Settings2}
        title="General"
        description="Configure general application settings."
      />

      <ToolApprovalSetting isActive={isActive} />
      <ExecutingTaskTimeoutSetting isActive={isActive} />
      <KeyMappingSetting isActive={isActive} />
      <StartupSetting isActive={isActive} />
      <CloseBehaviorSetting isActive={isActive} />
    </div>
  );
}
