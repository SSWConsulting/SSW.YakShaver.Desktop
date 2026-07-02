import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";

/** Detects whether the app is in Cloud 360 mode and whether the user is signed in to IS. */
export function useCloud360Mode() {
  const [is360Mode, setIs360Mode] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipcClient.llm.getConfig().then((cfg) => {
      if (!cancelled) setIs360Mode(cfg?.orchestrationBackend === "cloud-360");
    });
    // Matches the real shape read in IdentityServerAuthManager.tsx:28 —
    // `result.status === "authenticated"` (NOT `result.data.status`).
    ipcClient.auth.identityServer.status().then((res) => {
      if (!cancelled) setIsSignedIn(res?.status === "authenticated");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { is360Mode, isSignedIn };
}
