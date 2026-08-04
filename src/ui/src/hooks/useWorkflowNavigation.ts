import type { OrchestrationBackend } from "@shared/types/llm";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Optional router state carried to /workflow (e.g. which orchestrator backend this run used). */
export interface WorkflowNavState {
  backend?: OrchestrationBackend;
}

interface WorkflowNavigationTarget {
  shaveId?: string;
  state?: WorkflowNavState;
}

export function useWorkflowNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateToWorkflow = useCallback(
    (target?: WorkflowNavigationTarget) => {
      const path = target?.shaveId
        ? `/workflow/${encodeURIComponent(target.shaveId)}`
        : "/workflow";
      if (location.pathname !== path) {
        navigate(path, target?.state ? { state: target.state } : undefined);
      }
    },
    [navigate, location.pathname],
  );

  return navigateToWorkflow;
}
