import { McpSettingsPanel } from "../settings/mcp/McpServerManager";

interface MCPStepProps {
  onFormOpenChange: (isOpen: boolean) => void;
  onHasEnabledServers: (hasEnabled: boolean) => void;
}

export function MCPStep({ onFormOpenChange, onHasEnabledServers }: MCPStepProps) {
  return (
    <McpSettingsPanel
      onFormOpenChange={onFormOpenChange}
      onHasEnabledServers={onHasEnabledServers}
      includeBuiltin={false}
      viewMode="compact"
    />
  );
}
