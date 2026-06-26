import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface UseWorkflowNavigationOptions {
  listen?: boolean;
}

export function useWorkflowNavigation(options?: UseWorkflowNavigationOptions) {
  const navigate = useNavigate();
  const location = useLocation();
  const listen = options?.listen ?? true;

  const navigateToWorkflow = useCallback(() => {
    if (location.pathname !== "/workflow") {
      navigate("/workflow");
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (!listen) {
      return;
    }

    const cleanup = window.electronAPI.workflow.onProgressNeo(navigateToWorkflow);
    return cleanup;
  }, [listen, navigateToWorkflow]);

  return navigateToWorkflow;
}
