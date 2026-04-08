import { Outlet } from "react-router-dom";
import { useWorkflowNavigation } from "../../hooks/useWorkflowNavigation";
import Sidebar from "./sidebar";

export function Layout() {
  useWorkflowNavigation();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="z-10 flex-1 ml-[18rem] min-w-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
