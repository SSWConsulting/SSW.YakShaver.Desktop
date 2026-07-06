import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { LLM_CONFIG_CHANGED_EVENT } from "../../types";

/** Detects whether the app is in YakShaver 360 mode and whether the user is signed in to IS. */
export function useCloud360Mode() {
  const [is360Mode, setIs360Mode] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      ipcClient.llm.getConfig().then((cfg) => {
        if (!cancelled) setIs360Mode(cfg?.orchestrationBackend === "cloud-360");
      });
      // Matches the real shape read in IdentityServerAuthManager.tsx:28 —
      // `result.status === "authenticated"` (NOT `result.data.status`).
      ipcClient.auth.identityServer.status().then((res) => {
        if (!cancelled) setIsSignedIn(res?.status === "authenticated");
      });
    };

    read();
    // The backend is changed in the Settings dialog, which doesn't remount this
    // page; re-read on the config-changed event (and on window focus) so switching
    // to 360 takes effect immediately instead of only after an app restart.
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, []);

  return { is360Mode, isSignedIn };
}
