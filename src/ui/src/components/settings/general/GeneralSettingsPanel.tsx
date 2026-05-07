import { Settings2 } from "lucide-react";
import { KeyMappingSetting } from "./KeyMappingSetting";
import { StartupSetting } from "./StartupSetting";
import { ToolApprovalSetting } from "./ToolApprovalSetting";

interface GeneralSettingsPanelProps {
  isActive: boolean;
}

export function GeneralSettingsPanel({ isActive }: GeneralSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          General
        </h2>
        <p className="text-sm text-muted-foreground">Configure general application settings.</p>
      </div>

      <ToolApprovalSetting isActive={isActive} />
      <KeyMappingSetting isActive={isActive} />
      <StartupSetting isActive={isActive} />
    </div>
  );
}
