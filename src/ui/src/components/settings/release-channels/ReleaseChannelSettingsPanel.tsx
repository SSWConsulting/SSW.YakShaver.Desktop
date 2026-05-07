import { GitHubTokenSetting } from "./GitHubTokenSetting";
import { ReleaseChannelSetting } from "./ReleaseChannelSetting";

interface ReleaseChannelSettingsPanelProps {
  isActive: boolean;
}

export function ReleaseChannelSettingsPanel({ isActive }: ReleaseChannelSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Releases</h2>
        <p className="text-sm text-muted-foreground">
          Configure update channels and GitHub access for PR releases.
        </p>
      </div>

      <ReleaseChannelSetting isActive={isActive} />
      <GitHubTokenSetting isActive={isActive} />
    </div>
  );
}
