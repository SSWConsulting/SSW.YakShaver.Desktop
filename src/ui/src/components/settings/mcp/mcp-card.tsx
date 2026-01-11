import { Button } from "@/components/ui/button";
import { MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";
import { useState } from "react";
import { on } from "events";

interface McpCardProps {
  icon: React.ReactElement;
  isReadOnly?: boolean;
  config: MCPServerConfig;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onDelete?: () => void;
  onUpdate?: (data: MCPServerConfig) => Promise<void>;
}

export function McpCard({
  icon,
  config,
  onConnect,
  onDisconnect,
  onDelete,
  onUpdate,
  isReadOnly,
}: McpCardProps) {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div
      className={`flex flex-col rounded-lg border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)] pt-4 pr-6 pb-4 pl-6 opacity-100 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.08)] hover:border-white/40 ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
      onClick={() => {
        if (!isReadOnly) setShowSettings(!showSettings);
      }}
    >
      {!showSettings && (
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center">
            <span className="size-8 flex items-center justify-center">{icon}</span>
            <div className="flex flex-col ml-4">
              <span className="text-base font-medium">{config.name}</span>
              {config.description && (
                <span className="text-sm text-gray-400">{config.description}</span>
              )}
            </div>
          </div>
          {!config.enabled && (
            <Button variant="outline" onClick={onConnect}>
              {" "}
              Connect{" "}
            </Button>
          )}
          {config.enabled && (
            <Button variant="destructive" onClick={onDisconnect}>
              {" "}
              Disconnect{" "}
            </Button>
          )}
        </div>
      )}
      {showSettings && !isReadOnly && (
        <div onClick={(e) => e.stopPropagation()}>
          <McpServerFormWrapper
            isEditing={true}
            initialData={config}
            onCancel={() => {
              setShowSettings(false);
            }}
            onSubmit={(data) => {
              setShowSettings(false);
              return onUpdate?.(data) ?? Promise.resolve();
            }}
            onDelete={
              onDelete ??
              (() => {
                setShowSettings(false);
              })
            }
            isLoading={false}
          />
        </div>
      )}
    </div>
  );
}
