import { useEffect } from "react";
import type { StepHandlers } from "@/types/onboarding";
import { McpSettingsPanel } from "../settings/mcp/McpServerManager";

interface MCPStepProps {
  onFormOpenChange: (isOpen: boolean) => void;
  onRegisterHandlers: (handlers: StepHandlers) => void;
}

export function MCPStep({ onFormOpenChange, onRegisterHandlers }: MCPStepProps) {
  useEffect(() => {
    onRegisterHandlers({ isReady: true, validate: () => true });
  }, [onRegisterHandlers]);

  return (
    <McpSettingsPanel
      onFormOpenChange={onFormOpenChange}
      onHasEnabledServers={() => {}}
      includeBuiltin={false}
      viewMode="compact"
    />
  );
}
