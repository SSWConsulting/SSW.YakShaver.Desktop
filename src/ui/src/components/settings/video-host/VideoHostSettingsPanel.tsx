import { Youtube } from "lucide-react";
import { YouTubeConnection } from "../../auth/YouTubeConnection";
import { SettingsPageHeader } from "../SettingsPageHeader";

interface VideoHostSettingsPanelProps {
  isActive: boolean;
}

export function VideoHostSettingsPanel({ isActive }: VideoHostSettingsPanelProps) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Youtube}
        title="Video Host"
        description="Choose a platform to host your videos."
      />

      <div className="grid gap-4">
        <YouTubeConnection buttonSize="lg" />
      </div>
    </div>
  );
}
