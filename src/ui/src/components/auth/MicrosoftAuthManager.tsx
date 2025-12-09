import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { Button } from "@/components/ui/button";

export function MicrosoftAuthManager() {
  const [status, setStatus] = useState<{ isAuthenticated: boolean; name?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">Microsoft: {status?.isAuthenticated ? "Connected" : "Not Connected"}</span>
      {!status?.isAuthenticated ? (
        <Button disabled={loading} onClick={login}>Sign In</Button>
      ) : (
        <Button variant="secondary" disabled={loading} onClick={logout}>Sign Out</Button>
      )}
      {status?.isAuthenticated && (
        <span className="text-xs opacity-80">{status.name} · {status.email}</span>
      )}
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  );
}

