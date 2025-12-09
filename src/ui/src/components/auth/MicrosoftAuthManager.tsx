import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";
import { MyShavesDialog } from "@/components/portal/MyShavesDialog";

export function MicrosoftAuthManager() {
  const [status, setStatus] = useState<{ isAuthenticated: boolean; name?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMyShaves, setShowMyShaves] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await ipcClient.msAuth.status();
      if (s.status === "authenticated") {
        const me = await ipcClient.msAuth.accountInfo();
        const d = me.data as any;
        setStatus({ isAuthenticated: true, name: d?.name, email: d?.username });
      } else {
        setStatus({ isAuthenticated: false });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const login = async () => {
    setLoading(true);
    setError(null);
    const res = await ipcClient.msAuth.login();
    if (res.success) { await refresh(); } else { setError(res.error || "Authentication failed"); }
    setLoading(false);
  };

  const logout = async () => {
    setLoading(true);
    setError(null);
    await ipcClient.msAuth.logout();
    await refresh();
    setLoading(false);
  };

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!status?.isAuthenticated) {
    return (
      <div className="flex items-center">
        <Button 
          onClick={login}
        >
          Sign In
        </Button>
        {error && <span className="text-ssw-red text-xs ml-2">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger className="cursor-pointer">
          <Avatar className="w-8 h-8">
            <AvatarFallback>
              {getInitials(status?.name)}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <div className="p-3">
            <div className="mb-3 pb-3 border-b border-white/10">
              <p className="text-sm font-medium text-white truncate">{status?.name}</p>
            </div>
            <DropdownMenuItem 
              onClick={() => setShowMyShaves(true)}
              className="text-white hover:bg-white/10"
            >
              <span>My Shaves</span>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={logout}
              disabled={loading}
              className="text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-ssw-red text-xs ml-2">{error}</span>}
      <MyShavesDialog 
        open={showMyShaves} 
        onOpenChange={setShowMyShaves} 
      />
    </div>
  );
}