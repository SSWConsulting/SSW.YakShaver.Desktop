import { useEffect, useState } from "react";
import type { StepHandlers } from "@/types/onboarding";
import { McpSettingsPanel } from "../settings/mcp/McpServerManager";

interface MCPStepProps {
  onFormOpenChange: (isOpen: boolean) => void;
  onRegisterHandlers: (handlers: StepHandlers) => void;
}

export function MCPStep({ onFormOpenChange, onRegisterHandlers }: MCPStepProps) {
  const [hasEnabledServers, setHasEnabledServers] = useState(false);

  useEffect(() => {
    onRegisterHandlers({
      isReady: hasEnabledServers,
      validate: () => hasEnabledServers,
    });
  }, [hasEnabledServers, onRegisterHandlers]);

  return (
    <McpSettingsPanel
      onFormOpenChange={onFormOpenChange}
      onHasEnabledServers={setHasEnabledServers}
      includeBuiltin={false}
      viewMode="compact"
    />
  );
}
