import type { OrchestrationBackend } from "@shared/types/llm";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Optional router state carried to /workflow (e.g. which orchestrator backend this run used). */
export interface WorkflowNavState {
  backend?: OrchestrationBackend;
}

export function useWorkflowNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateToWorkflow = useCallback(
    (state?: WorkflowNavState) => {
      if (location.pathname !== "/workflow") {
        navigate("/workflow", state ? { state } : undefined);
      }
    },
    [navigate, location.pathname],
  );

  return navigateToWorkflow;
}
