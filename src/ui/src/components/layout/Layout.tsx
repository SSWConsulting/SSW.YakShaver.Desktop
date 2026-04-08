import { Outlet } from "react-router-dom";
import Sidebar from "./sidebar";


export function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="z-10 flex-1 ml-[18rem] min-w-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
