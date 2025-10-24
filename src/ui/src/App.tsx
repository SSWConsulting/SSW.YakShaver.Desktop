import { Toaster } from "sonner";
import "./App.css";
import logoImage from "/logos/YakShaver-Vertical-Color-Darkmode.svg?url";
import { VideoHostPanel } from "./components/layout/VideoHostPanel";
import { WorkflowProgressPanel } from "./components/workflow/WorkflowProgressPanel";
import { FinalResultPanel } from "./components/workflow/FinalResultPanel";
import { ScreenRecorder } from "./components/recording/ScreenRecorder";
import { YouTubeAuthProvider } from "./contexts/YouTubeAuthContext";

export default function App() {
  return (
    <div className="min-h-screen py-8 text-white">
      <Toaster />
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="flex flex-col gap-8">
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
  );
}
