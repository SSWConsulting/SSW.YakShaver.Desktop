import { McpSettingsPanel } from "../settings/mcp/McpServerManager";

interface MCPStepProps {
  onFormOpenChange: (isOpen: boolean) => void;
  onValidationChange: (isValid: boolean) => void;
}

export function MCPStep({ onFormOpenChange, onValidationChange }: MCPStepProps) {
  return (
    <McpSettingsPanel
      onFormOpenChange={onFormOpenChange}
      onHasEnabledServers={onValidationChange}
      includeBuiltin={false}
      viewMode="compact"
    />
  );
}
