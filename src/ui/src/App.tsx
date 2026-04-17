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
import { WorkflowPage } from "./pages/WorkflowPage";
import { ipcClient } from "./services/ipc-client";

export default function App() {
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(false);

  // Auto-save shaves when workflow completes
  useShaveManager();

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
                      <Route path="/workflow" element={<WorkflowPage />} />
                    </Route>
                  </Routes>
                </HashRouter>
              )}
            </div>
          </InteractionProvider>
        </TelemetryConsentInitializer>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
