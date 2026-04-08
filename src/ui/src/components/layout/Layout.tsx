import { Outlet } from "react-router-dom";
import { SettingsDialog } from "../settings/SettingsDialog";
import { MicrosoftAuthManager } from "../auth/MicrosoftAuthManager";
import Sidebar from "./sidebar";


export function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-56">
        <div className="absolute top-6 right-8 z-50 flex items-center gap-4">
          <SettingsDialog />
          <MicrosoftAuthManager />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
