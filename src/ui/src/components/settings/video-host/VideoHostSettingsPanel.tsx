import { Youtube } from "lucide-react";
import { YouTubeConnection } from "../../auth/YouTubeConnection";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { LocalStorageHostCard } from "./LocalStorageHostCard";

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
        description="Videos are saved locally by default. Connect a platform to upload them instead."
      />

      <div className="grid gap-4">
        <LocalStorageHostCard buttonSize="lg" />
        <YouTubeConnection buttonSize="lg" />
      </div>
    </div>
  );
}
