import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import "./App.css";
import logoImage from "/logos/YakShaver-Vertical-Color-Darkmode.svg?url";
import { MicrosoftAuthManager } from "./components/auth/MicrosoftAuthManager";
import { DownloadProgressToast } from "./components/common/DownloadProgressToast";
import { VideoHostPanel } from "./components/layout/VideoHostPanel";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { ScreenRecorder } from "./components/recording/ScreenRecorder";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { MyShavesDialog } from "./components/shaves/MyShavesDialog";
import { FinalResultPanel } from "./components/workflow/FinalResultPanel";
import { WorkflowProgressPanel } from "./components/workflow/WorkflowProgressPanel";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { useShaveManager } from "./hooks/useShaveManager";

export default function App() {
  const [appVersion, setAppVersion] = useState<string>("");
  const [commitHash, setCommitHash] = useState<string>("");

  // Auto-save shaves when workflow completes
  useShaveManager();

  useEffect(() => {
    const fetchVersion = async () => {
      const info = await window.electronAPI.releaseChannel.getCurrentVersion();
      setAppVersion(info.version);
      setCommitHash(info.commitHash);
    };
    fetchVersion();
  }, []);

  return (
    <AdvancedSettingsProvider>
      <YouTubeAuthProvider>
        <div className="relative min-h-screen py-8 text-white">
          <Toaster />
          <DownloadProgressToast />
          <OnboardingWizard />
          <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

          <div className="flex flex-col gap-8">
            <div className="absolute top-6 right-8 z-50 flex items-center gap-4">
              <MyShavesDialog />
              <SettingsDialog />
              <MicrosoftAuthManager />
            </div>
            <header className="z-10 relative">
              <div className="container mx-auto flex flex-col items-center gap-8">
                <h1>
                  <img src={logoImage} alt="YakShaver" />
                </h1>
              </div>
            </header>

            <main className="z-10 relative">
              <ScreenRecorder />
              <VideoHostPanel />
              <WorkflowProgressPanel />
              <FinalResultPanel />
            </main>
          </div>

          <div className="fixed bottom-2 left-2 text-[10px] text-white/30 z-50 pointer-events-none select-none font-mono">
            {appVersion && `v${appVersion}`}
            {commitHash && ` (${commitHash.substring(0, 7)})`}
          </div>
        </div>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
