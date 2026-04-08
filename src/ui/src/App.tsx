import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Toaster, toast } from "sonner";
import "./App.css";
import { DownloadProgressToast } from "./components/common/DownloadProgressToast";
import { TelemetryConsentInitializer } from "./components/common/TelemetryConsentInitializer";
import { Layout } from "./components/layout/Layout";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { InteractionProvider } from "./components/user-interaction/InteractionProvider";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { useShaveManager } from "./hooks/useShaveManager";
import { HomePage } from "./pages/HomePage";
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
          <InteractionProvider>
            <div className="relative min-h-screen text-white">
              <Toaster />
              <DownloadProgressToast />
              <OnboardingWizard onVisibilityChange={setIsOnboardingVisible} />
              <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

              {!isOnboardingVisible && (
                <HashRouter>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route path="/" element={<HomePage />} />
                    </Route>
                  </Routes>
                </HashRouter>
              )}

              <div className="fixed bottom-2 left-2 text-[10px] text-white/30 z-50 pointer-events-none font-mono">
                {appVersion && `v${appVersion} `}
                {commitHash && `(${commitHash})`}
              </div>
            </div>
          </InteractionProvider>
        </TelemetryConsentInitializer>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
