import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { IS_AUTH_CHANGED_EVENT, LLM_CONFIG_CHANGED_EVENT } from "../../types";

/** Detects whether the app is in YakShaver 360 mode and whether the user is signed in to IS. */
export function useCloud360Mode() {
  const [is360Mode, setIs360Mode] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  // #1023 review — both values start from a false default and only resolve once the
  // IPC calls below settle. Callers that derive a disabled-reason/status message from
  // is360Mode/isSignedIn need to know when that initial resolution is still pending, so
  // they can suppress the message rather than flash a wrong one for an already-connected
  // user. True only for the very first read; refreshes triggered by the events below
  // don't re-enter a loading state since the previous values remain valid until replaced.
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const read = (isInitial: boolean) => {
      Promise.allSettled([
        ipcClient.llm
          .getConfig()
          .then((cfg) => {
            if (!cancelled) setIs360Mode(cfg?.orchestrationBackend === "cloud-360");
          })
          .catch(() => {
            if (!cancelled) setIs360Mode(false);
          }),
        // Auth shape is `result.status === "authenticated"`, not `result.data.status`.
        ipcClient.auth.identityServer
          .status()
          .then((res) => {
            if (!cancelled) setIsSignedIn(res?.status === "authenticated");
          })
          .catch(() => {
            if (!cancelled) setIsSignedIn(false);
          }),
      ]).then(() => {
        if (!cancelled && isInitial) setIsLoading(false);
      });
    };

    read(true);
    // Settings/sign-in change without remounting this page, so re-read on those
    // events (and focus) — otherwise 360 mode stays stale until an app restart.
    const onRefresh = () => read(false);
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, onRefresh);
    window.addEventListener(IS_AUTH_CHANGED_EVENT, onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, onRefresh);
      window.removeEventListener(IS_AUTH_CHANGED_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, []);

  return { is360Mode, isSignedIn, isLoading };
}
