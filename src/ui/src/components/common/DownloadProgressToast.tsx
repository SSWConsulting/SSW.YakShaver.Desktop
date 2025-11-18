import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";

export function DownloadProgressToast() {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.releaseChannel.onDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);

      // Clear progress when complete
      if (progress.percent >= 100) {
        setTimeout(() => {
          setDownloadProgress(null);
        }, 2000);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (downloadProgress === null) {
    return null;
  }

  return (
    <Card className="fixed bottom-6 right-6 z-[100] w-80 bg-black/30 border-white/20 shadow-2xl animate-in slide-in-from-bottom-5">
      <CardHeader className="flex justify-between items-center">
        <CardTitle className="text-white">Downloading update...</CardTitle>
        <span className="text-sm text-white/70">{downloadProgress}%</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress
          value={downloadProgress}
          className="h-2 bg-secondary/20 [&>[data-slot=progress-indicator]]:bg-secondary"
        />
      </CardContent>
    </Card>
  );
}
