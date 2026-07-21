import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { HealthStatus } from "@/components/health-status/health-status";
import { Button } from "@/components/ui/button";

import type { HealthStatusInfo } from "@/types";
import { type MCPServerConfig, McpServerFormWrapper } from "./McpServerForm";

interface McpCardProps {
  icon: React.ReactElement;
  isReadOnly?: boolean;
  config: MCPServerConfig;
  healthInfo?: HealthStatusInfo | null;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onReauthorize?: () => void | Promise<void>;
  onDelete?: () => void;
  hideDelete?: boolean;
  onUpdate?: (data: MCPServerConfig) => Promise<void>;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
  extraContent?: React.ReactNode;
  /** Replaces the default Connect button when provided */
  renderConnectButton?: () => React.ReactNode;
}

export function McpCard({
  icon,
  config,
  onConnect,
  onDisconnect,
  onReauthorize,
  onDelete,
  hideDelete,
  onUpdate,
  isReadOnly,
  onTools,
  healthInfo = null,
  viewMode = "compact",
  extraContent,
  renderConnectButton,
}: McpCardProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isReauthorizing, setIsReauthorizing] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Auth-failed servers show Reauthorize in place of Disconnect (#982).
  const showReauthorize = Boolean(healthInfo?.authFailed && onReauthorize);

  // Latch a stable button for the whole re-auth round-trip so it doesn't
  // flicker through other states while the parent re-checks health (#982).
  const handleReauthorizeClick = async () => {
    if (isReauthorizing) return;
    setIsReauthorizing(true);
    try {
      await onReauthorize?.();
    } finally {
      setIsReauthorizing(false);
    }
  };
  return (
    <>
      {/* biome-ignore lint : lint message can be ignored for now as we don't support fully keyboard navigation and waiting for new designs */}
      <div
        className={`flex flex-col rounded-lg border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)] pt-4 pr-6 pb-4 pl-6 opacity-100 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.08)] hover:border-white/40 ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
        onClick={(e) => {
          if (!isReadOnly && !actionsRef.current?.contains(e.target as Node | null))
            setShowSettings(!showSettings);
        }}
      >
        {!showSettings && (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              {healthInfo && (
                <HealthStatus
                  isChecking={healthInfo.isChecking}
                  isDisabled={!config.enabled}
                  isHealthy={healthInfo.isHealthy}
                  successMessage={healthInfo.successMessage}
                  authFailed={healthInfo.authFailed}
                  error={healthInfo.error}
                  className="mr-4"
                />
              )}
              <span className="size-8 flex items-center justify-center">{icon}</span>
              <div className="flex flex-col ml-4">
                <span className="text-base font-medium">{config.name}</span>
                {config.description && (
                  <span className="text-sm text-gray-400">{config.description}</span>
                )}
              </div>
            </div>

            <div ref={actionsRef} className="flex items-center gap-2">
              {viewMode === "detailed" && onTools && (
                <Button variant="outline" onClick={() => onTools()}>
                  Tools
                </Button>
              )}
              {isReauthorizing ? (
                <Button variant="warningOutline" className="min-w-28" disabled>
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                  Reauthorizing…
                </Button>
              ) : (
                <>
                  {!config.enabled && renderConnectButton && renderConnectButton()}
                  {!config.enabled && !renderConnectButton && (
                    <Button
                      variant="outline"
                      className="w-28 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect?.();
                      }}
                    >
                      Connect
                    </Button>
                  )}
                  {config.enabled &&
                    (showReauthorize ? (
                      <Button
                        variant="warningOutline"
                        className="w-28 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReauthorizeClick();
                        }}
                      >
                        Reauthorize
                      </Button>
                    ) : (
                      <Button
                        variant="destructiveOutline"
                        className="w-28 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDisconnect?.();
                        }}
                      >
                        Disconnect
                      </Button>
                    ))}
                </>
              )}
            </div>
          </div>
        )}

        {showSettings && !isReadOnly && (
          <>
            {/* biome-ignore lint : no need to implement keyboard navigation for now */}
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
                hideDeleteServerButton={hideDelete}
                isLoading={false}
              />
            </div>
          </>
        )}
        {extraContent}
      </div>
    </>
  );
}
