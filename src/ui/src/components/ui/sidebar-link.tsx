import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface SidebarLinkProps {
    to: string;
    children: ReactNode;
}

export function SidebarLink({ to, children }: SidebarLinkProps) {
    return (
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          `flex items-center gap-2 px-6 py-4 rounded-md text-sm transition-colors duration-300 ${
            isActive
              ? "bg-white/8 text-white hover:bg-white/15"
              : "text-white/60 bg-transparent hover:text-white hover:bg-white/10"
          }`
        }
      >
        {children}
      </NavLink>
    );
  }