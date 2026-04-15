import YakOutline from "/logos/SQ-YakShaver-LogoIcon-Outline.svg?url";
import logoImage from "/logos/YakShaver-Horizontal-Color-Darkmode.svg?url";
import { MicrosoftAuthManager } from "../auth/MicrosoftAuthManager";
import { ScreenRecorder } from "../recording/ScreenRecorder";
import { SettingsDialog } from "../settings/SettingsDialog";
import { SidebarLink } from "../ui/sidebar-link";

export default function Sidebar() {
  return (
    <div className=" fixed top-0 left-0 w-[18rem] h-full bg-black/60 border-r border-white/25 flex flex-col gap-6 p-8 z-40">
      <h1>
        <img src={logoImage} alt="YakShaver" />
      </h1>
      <ScreenRecorder showButtonOnly={true} className="w-full justify-start" />
      <nav className="flex flex-col gap-6">
        <SidebarLink to="/">
          <img src={YakOutline} alt="YakShaver" className="h-4 w-4" />
          Shaves
        </SidebarLink>
        {/* TODO: Add in for https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/816  */}
        {/* <SidebarLink to="/projects">
          <Folders className="h-4 w-4" />
          Projects
        </SidebarLink> */}
      </nav>
      <div className="relative bottom-0 mt-auto flex flex-col gap-3 left-0">
        <SettingsDialog />
        <MicrosoftAuthManager />
      </div>
    </div>
  );
}
