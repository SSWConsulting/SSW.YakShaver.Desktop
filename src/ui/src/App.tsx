import { useState } from "react";
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
import { WorkflowProgressPanelNeo } from "./components/workflow/WorkflowProgressPanelNeo";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { useShaveManager } from "./hooks/useShaveManager";

export default function App() {
  // Auto-save shaves when workflow completes
  useShaveManager();
  const [activeTab, setActiveTab] = useState<"legacy" | "neo">("neo");

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

            <main className="z-10 relative flex flex-col items-center">
              <ScreenRecorder />
              <VideoHostPanel />


{/* TODO: Logic for switching between legacy and neo workflows */}
{/* should be removed after testing */}
              <div className="w-full max-w-2xl mt-8">
                <div className="flex border-b border-white/20 mb-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab("legacy")}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === "legacy"
                        ? "border-ssw-red text-white"
                        : "border-transparent text-white/50 hover:text-white/80"
                    }`}
                  >
                    Legacy Workflow
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("neo")}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === "neo"
                        ? "border-ssw-red text-white"
                        : "border-transparent text-white/50 hover:text-white/80"
                    }`}
                  >
                    Neo Workflow
                  </button>
                </div>

                <div className={activeTab === "legacy" ? "block" : "hidden"}>
                  <WorkflowProgressPanel />
                </div>
                <div className={activeTab === "neo" ? "block" : "hidden"}>
                  <WorkflowProgressPanelNeo />
                </div>
              </div>
{/*  */}
{/*  */}
              <FinalResultPanel />
            </main>
          </div>
        </div>
      </YouTubeAuthProvider>
    </AdvancedSettingsProvider>
  );
}
