import { NavLink } from "react-router-dom";

interface SidebarLinkProps {
    to: string;
    children: React.ReactNode;
}

export function SidebarLink({ to, children }: SidebarLinkProps) {
    return (
      <NavLink
        to={to}
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
            isActive
              ? "bg-white/15 text-white"
              : "text-white/60 hover:text-white hover:bg-white/10"
          }`
        }
      >
        {children}
      </NavLink>
    );
  }