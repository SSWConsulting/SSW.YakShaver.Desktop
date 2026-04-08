import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useWorkflowNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const cleanup = window.electronAPI.workflow.onProgress(() => {
      if (location.pathname !== "/workflow") {
        navigate("/workflow");
      }
    });
    return cleanup;
  }, [navigate, location.pathname]);
}
