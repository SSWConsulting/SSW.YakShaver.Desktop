import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface UseWorkflowNavigationOptions {
  listen?: boolean;
}

/** Optional router state carried to /workflow (e.g. which orchestrator backend this run used). */
export interface WorkflowNavState {
  backend?: string;
}

export function useWorkflowNavigation(options?: UseWorkflowNavigationOptions) {
  const navigate = useNavigate();
  const location = useLocation();
  const listen = options?.listen ?? true;

  const navigateToWorkflow = useCallback(
    (state?: WorkflowNavState) => {
      if (location.pathname !== "/workflow") {
        navigate("/workflow", state ? { state } : undefined);
      }
    },
    [navigate, location.pathname],
  );

  useEffect(() => {
    if (!listen) {
      return;
    }

    const cleanup = window.electronAPI.workflow.onProgressNeo(() => navigateToWorkflow());
    return cleanup;
  }, [listen, navigateToWorkflow]);

  return navigateToWorkflow;
}
