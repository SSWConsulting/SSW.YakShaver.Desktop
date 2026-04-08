import { Outlet } from "react-router-dom";
import Sidebar from "./sidebar";


export function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 ml-56">
        <Outlet />
      </div>
    </div>
  );
}
