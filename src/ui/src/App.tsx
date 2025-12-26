import { Toaster } from "sonner";
import "./App.css";
import logoImage from "/logos/YakShaver-Vertical-Color-Darkmode.svg?url";
import { MicrosoftAuthManager } from "./components/auth/MicrosoftAuthManager";
import { DownloadProgressToast } from "./components/common/DownloadProgressToast";
import { VideoHostPanel } from "./components/layout/VideoHostPanel";
import { ScreenRecorder } from "./components/recording/ScreenRecorder";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { MyShavesDialog } from "./components/shaves/MyShavesDialog";
import { FinalResultPanel } from "./components/workflow/FinalResultPanel";
import { WorkflowProgressPanel } from "./components/workflow/WorkflowProgressPanel";
import { AdvancedSettingsProvider } from "./contexts/AdvancedSettingsContext";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";
import { useShaveManager } from "./hooks/useSaveManager";

export default function App() {
  // Auto-save shaves when workflow completes
  useShaveManager();

  return (
    <AdvancedSettingsProvider>
      <div className="relative min-h-screen py-8 text-white">
        <Toaster />
        <DownloadProgressToast />
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
            <YouTubeAuthProvider>
              <ScreenRecorder />
              <VideoHostPanel />
            </YouTubeAuthProvider>
            <WorkflowProgressPanel />
            <FinalResultPanel />
          </main>
        </div>
      </div>
    </AdvancedSettingsProvider>
  );
}
