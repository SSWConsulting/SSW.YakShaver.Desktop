import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";

interface McpServerFormCardProps {
  initialData: MCPServerConfig | null;
  viewMode: "edit" | "add";
  isLoading: boolean;
  servers: MCPServerConfig[];
  onSubmit: (data: MCPServerConfig) => Promise<void>;
  onCancel: () => void;
}

export function McpServerFormCard({
  initialData,
  viewMode,
  isLoading,
  servers,
  onSubmit,
  onCancel,
}: McpServerFormCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)] pt-4 pr-6 pb-4 pl-6 opacity-100">
      <McpServerFormWrapper
        initialData={initialData ?? undefined}
        isEditing={viewMode === "edit"}
        onSubmit={onSubmit}
        onCancel={onCancel}
        isLoading={isLoading}
        existingServerNames={servers.map((s) => s.name)}
      />
    </div>
  );
}
