import { Package } from "lucide-react";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { ReleaseChannelSetting } from "./ReleaseChannelSetting";

interface ReleaseChannelSettingsPanelProps {
  isActive: boolean;
}

export function ReleaseChannelSettingsPanel({ isActive }: ReleaseChannelSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Package}
        title="Releases"
        description="Choose between the latest stable release and public PR release builds."
      />

      <ReleaseChannelSetting isActive={isActive} />
    </div>
  );
}
