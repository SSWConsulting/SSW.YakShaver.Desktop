import { YouTubeConnection } from "../../auth/YouTubeConnection";

interface VideoHostSettingsPanelProps {
  isActive: boolean;
}

export function VideoHostSettingsPanel({ isActive }: VideoHostSettingsPanelProps) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Video Host</h2>
        <p className="text-sm text-white/70">Choose a platform to host your videos.</p>
      </div>

      <div className="grid gap-4">
        <YouTubeConnection buttonSize="lg" />
      </div>
    </div>
  );
}
