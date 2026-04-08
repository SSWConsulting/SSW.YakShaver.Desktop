import { Database } from "lucide-react";
import { ScreenRecorder } from "../recording/ScreenRecorder";
import logoImage from "/logos/YakShaver-Horizontal-Color-Darkmode.svg?url";
import { SidebarLink } from "../ui/sidebar-link";
import { MicrosoftAuthManager } from "../auth/MicrosoftAuthManager";
import { SettingsDialog } from "../settings/SettingsDialog";

export default function Sidebar() {
  return (
    <div className=" fixed top-0 left-0 h-full bg-black/60 border-r border-white/25 flex flex-col gap-6 p-8 z-40">
      <h1>
        <img src={logoImage} alt="YakShaver" />
      </h1>
      <ScreenRecorder showButtonOnly={true} className="w-full justify-start" />
      <nav className="flex flex-col gap-6">
        <SidebarLink to="/">
          <Database className="h-4 w-4" />
          My Shaves
        </SidebarLink>
        <SidebarLink to="/test">
          <Database className="h-4 w-4" />
          Projects
        </SidebarLink>
      </nav>
      <div className='relative bottom-0 mt-auto flex flex-col gap-6 left-0'>
        <SettingsDialog />
        <MicrosoftAuthManager />
      </div>
    </div>
  );
}
