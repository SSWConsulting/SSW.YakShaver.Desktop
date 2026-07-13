import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { IS_AUTH_CHANGED_EVENT, LLM_CONFIG_CHANGED_EVENT } from "../../types";

/** Detects whether the app is in YakShaver 360 mode and whether the user is signed in to IS. */
export function useCloud360Mode() {
  const [is360Mode, setIs360Mode] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      ipcClient.llm
        .getConfig()
        .then((cfg) => {
          if (!cancelled) setIs360Mode(cfg?.orchestrationBackend === "cloud-360");
        })
        .catch(() => {
          if (!cancelled) setIs360Mode(false);
        });
      // Auth shape is `result.status === "authenticated"`, not `result.data.status`.
      ipcClient.auth.identityServer
        .status()
        .then((res) => {
          if (!cancelled) setIsSignedIn(res?.status === "authenticated");
        })
        .catch(() => {
          if (!cancelled) setIsSignedIn(false);
        });
    };

    read();
    // Settings/sign-in change without remounting this page, so re-read on those
    // events (and focus) — otherwise 360 mode stays stale until an app restart.
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, read);
    window.addEventListener(IS_AUTH_CHANGED_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, read);
      window.removeEventListener(IS_AUTH_CHANGED_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, []);

  return { is360Mode, isSignedIn };
}
