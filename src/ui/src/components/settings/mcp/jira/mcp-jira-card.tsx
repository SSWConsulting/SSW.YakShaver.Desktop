import { JIRA_PRESET_CONFIG, PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useClipboard } from "@/hooks/useClipboard";
import { useMcpCardActions } from "@/hooks/useMcpCardActions";
import type { HealthStatusInfo } from "@/types";
import type { MCPServerConfig } from "../McpServerForm";
import { McpCard } from "../mcp-card";
import { AtlassianIcon } from "./atlassian";

const YAKSHAVER_DOMAIN = "https://api.yakshaver.ai/**";

interface McpJiraCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpJiraCard.Name = "Jira";
McpJiraCard.Id = PRESET_SERVER_IDS.JIRA;

export function McpJiraCard({ config, onChange, healthInfo, onTools, viewMode }: McpJiraCardProps) {
  const configLocal = config ?? JIRA_PRESET_CONFIG;

  const [setupExpanded, setSetupExpanded] = useState(false);
  const { copyToClipboard, copied } = useClipboard();

  const { handleOnConnect, handleOnDisconnect } = useMcpCardActions(
    McpJiraCard.Id,
    configLocal,
    onChange,
  );

  function handleDisconnect() {
    setSetupExpanded(false);
    handleOnDisconnect();
  }

  async function handleCopyDomain(): Promise<void> {
    await copyToClipboard(YAKSHAVER_DOMAIN, "Domain copied to clipboard");
  }

  const setupSection =
    setupExpanded && !configLocal.enabled ? (
      <div className="mt-4">
        <div className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/5 p-3">
          <p className="text-sm font-semibold text-white/90">One-time setup before connecting</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Trust YakShaver in your{" "}
            <a
              href="https://admin.atlassian.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300"
            >
              Atlassian admin <ExternalLink className="size-3" />
            </a>
            . Go to{" "}
            <span className="text-white/70">
              Apps &rsaquo; AI Settings &rsaquo; Rovo MCP server &rsaquo; Your domains
            </span>{" "}
            and add:
          </p>
          <div className="flex items-center gap-2 rounded bg-black/20 px-2 py-1.5">
            <code className="text-xs text-blue-300 flex-1">{YAKSHAVER_DOMAIN}</code>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 shrink-0"
              onClick={handleCopyDomain}
              title="Copy domain"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </div>
          <div className="flex justify-start">
            <Button
              variant="outline"
              className="w-28 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                handleOnConnect();
              }}
            >
              Connect
            </Button>
          </div>
        </div>
      </div>
    ) : null;

  function renderSetupButton() {
    return (
      <Button
        variant="outline"
        className="w-28 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setSetupExpanded((prev) => !prev);
        }}
      >
        {setupExpanded ? "Cancel" : "Set up"}
      </Button>
    );
  }

  return (
    <McpCard
      isReadOnly
      icon={<AtlassianIcon className="size-8" />}
      config={configLocal}
      healthInfo={healthInfo}
      onDisconnect={handleDisconnect}
      onTools={onTools}
      viewMode={viewMode}
      extraContent={setupSection}
      renderConnectButton={renderSetupButton}
    />
  );
}
