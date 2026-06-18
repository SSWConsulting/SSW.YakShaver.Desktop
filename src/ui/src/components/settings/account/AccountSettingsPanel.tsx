import { CircleUserRound } from "lucide-react";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { ResetAccountSetting } from "./ResetAccountSetting";
import { SetupWizardSetting } from "./SetupWizardSetting";
import { TelemetryUsageDataSetting } from "./TelemetryUsageDataSetting";

interface AccountSettingsPanelProps {
  isActive: boolean;
}

export function AccountSettingsPanel({ isActive }: AccountSettingsPanelProps) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={CircleUserRound}
        title="Account"
        description="Manage your YakShaver account settings and preferences."
      />

      <TelemetryUsageDataSetting />
      <SetupWizardSetting />
      <ResetAccountSetting />
    </div>
  );
}
