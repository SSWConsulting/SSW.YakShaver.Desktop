import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import "./App.css";
import logoImage from "/logos/YakShaver-Vertical-Color-Darkmode.svg?url";
import { MicrosoftAuthManager } from "./components/auth/MicrosoftAuthManager";
import { DownloadProgressToast } from "./components/common/DownloadProgressToast";
import { TelemetryConsentInitializer } from "./components/common/TelemetryConsentInitializer";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { ScreenRecorder } from "./components/recording/ScreenRecorder";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { MyShavesDialog } from "./components/shaves/MyShavesDialog";
import { ApprovalDialog } from "./components/workflow/ApprovalDialog";
import { FinalResultPanel } from "./components/workflow/FinalResultPanel";
import { WorkflowProgressPanel } from "./components/workflow/WorkflowProgressPanel";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { useShaveManager } from "./hooks/useShaveManager";
import { ipcClient } from "./services/ipc-client";

export default function App() {
  const [appVersion, setAppVersion] = useState<string>("");
  const [commitHash, setCommitHash] = useState<string>("");
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(false);

  // Auto-save shaves when workflow completes
  useShaveManager();

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const info = await window.electronAPI.releaseChannel.getCurrentVersion();
        setAppVersion(info.version);
        setCommitHash(info.commitHash);
      } catch (error) {
        console.error("Failed to fetch app version information:", error);
      }
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    const unsubscribe = ipcClient.app.onProtocolError((message) => {
      toast.error(message);
    });
    return () => unsubscribe();
  }, []);

  return (
    <AdvancedSettingsProvider>
      <YouTubeAuthProvider>
        <TelemetryConsentInitializer>
          <div className="relative min-h-screen py-8 text-white">
            <Toaster />
            <DownloadProgressToast />
            <OnboardingWizard onVisibilityChange={setIsOnboardingVisible} />
            <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

            {!isOnboardingVisible && (
              <div className="flex flex-col gap-8">
                <div className="absolute top-6 right-8 z-50 flex items-center gap-4">
                  <MyShavesDialog />
                  <SettingsDialog />
                  <MicrosoftAuthManager />
                </div>
                <ApprovalDialog />
                <header className="z-10 relative">
                  <div className="container mx-auto flex flex-col items-center gap-8">
                    <h1>
                      <img src={logoImage} alt="YakShaver" />
                    </h1>
                  </div>
                </header>

                <main className="z-10 relative flex flex-col items-center">
                  <ScreenRecorder />
                  <WorkflowProgressPanel />
                  <FinalResultPanel />
                </main>
              </div>
            )}

            <div className="fixed bottom-2 left-2 text-[10px] text-white/30 z-50 pointer-events-none font-mono">
              {appVersion && `v${appVersion} `}
              {commitHash && `(${commitHash})`}
            </div>
          </div>
        </TelemetryConsentInitializer>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
