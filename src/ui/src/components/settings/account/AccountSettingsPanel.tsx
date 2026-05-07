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
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">
          Manage your YakShaver account settings and preferences.
        </p>
      </div>

      <TelemetryUsageDataSetting />
      <SetupWizardSetting />
      <ResetAccountSetting />
    </div>
  );
}
