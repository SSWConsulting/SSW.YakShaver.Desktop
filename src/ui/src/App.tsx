import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sonner";
import "./App.css";
import logoImage from "/logos/YakShaver-Vertical-Color-Darkmode.svg?url";
import { DownloadProgressToast } from "./components/common/DownloadProgressToast";
import { Button } from "./components/ui/button";
import { VideoHostPanel } from "./components/layout/VideoHostPanel";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { ScreenRecorder } from "./components/recording/ScreenRecorder";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { FinalResultPanel } from "./components/workflow/FinalResultPanel";
import { WorkflowProgressPanel } from "./components/workflow/WorkflowProgressPanel";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { ipcClient } from "./services/ipc-client";
import { MicrosoftAuthManager } from "./components/auth/MicrosoftAuthManager";

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const generalSettings = await ipcClient.generalSettings.get();
        if (!generalSettings.onboardingCompleted) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.error("Failed to load onboarding status", error);
      } finally {
        setIsCheckingOnboarding(false);
      }
    };

    void checkOnboarding();
  }, []);

  const handleOpenOnboarding = useCallback(() => {
    setShowOnboarding(true);
  }, []);

  const handleFinishOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    try {
      await ipcClient.generalSettings.setOnboardingCompleted(true);
    } catch (error) {
      console.error("Failed to save onboarding status", error);
    }
  }, []);

  return (
    <AdvancedSettingsProvider>
      <YouTubeAuthProvider>
        <div className="relative min-h-screen py-8 text-white">
          <Toaster />
          <DownloadProgressToast />
          <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

          <div className="flex flex-col gap-8">
            <div className="absolute top-6 right-8 z-50 flex items-center gap-4">
              {showOnboarding && !isCheckingOnboarding && (
                <OnboardingWizard
                  open={showOnboarding}
                  onComplete={handleFinishOnboarding}
                  onSkip={handleFinishOnboarding}
                />
              )}
              <SettingsDialog />
              <MicrosoftAuthManager />
            </div>
            <div className="container mx-auto flex flex-col items-center gap-8">
              <h1>
                <img src={logoImage} alt="YakShaver" />
              </h1>
            </div>
            <div className="absolute top-6 left-8 z-50">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleOpenOnboarding}
                aria-label="Open onboarding wizard"
              >
                Onboarding
              </Button>
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
        </div>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
