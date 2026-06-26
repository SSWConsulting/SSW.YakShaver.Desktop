import { Package } from "lucide-react";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { GitHubTokenSetting } from "./GitHubTokenSetting";
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
        description="Configure update channels and GitHub access for PR releases."
      />

      <ReleaseChannelSetting isActive={isActive} />
      <GitHubTokenSetting isActive={isActive} />
    </div>
  );
}
