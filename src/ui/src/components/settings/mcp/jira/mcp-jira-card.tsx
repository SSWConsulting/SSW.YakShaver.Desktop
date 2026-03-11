import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMcpCardActions } from "@/hooks/useMcpCardActions";
import type { HealthStatusInfo } from "@/types";
import type { MCPServerConfig } from "../McpServerForm";
import { McpCard } from "../mcp-card";
import { AtlassianIcon } from "./atlassian";

const YAKSHAVER_DOMAIN = "https://api.yakshaver.ai/**";
const DISMISS_KEY = "jira-setup-dismissed";

interface McpJiraCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpJiraCard.Name = "Jira";
McpJiraCard.Id = "0f03a50c-219b-46e9-9ce3-54f925c44479";

export function McpJiraCard({ config, onChange, healthInfo, onTools, viewMode }: McpJiraCardProps) {
  const configLocal = config ?? {
    id: McpJiraCard.Id,
    name: McpJiraCard.Name,
    transport: "streamableHttp",
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Atlassian MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "true");

  const { handleOnConnect, handleOnDisconnect } = useMcpCardActions(
    McpJiraCard.Id,
    configLocal,
    onChange,
  );

  function handleCopyDomain(): void {
    navigator.clipboard.writeText(YAKSHAVER_DOMAIN);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Domain copied to clipboard");
  }

  function handleDismiss(): void {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  const prerequisiteSection =
    !configLocal.enabled && !dismissed ? (
      <div className="mt-4">
        <div className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-white/90">One-time setup before connecting</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 shrink-0 text-white/40 hover:text-white/70"
              onClick={handleDismiss}
              title="Dismiss"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Trust YakShaver in your{" "}
            <a
              href="https://admin.atlassian.com"
              target="_blank"
              rel="noreferrer"
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
        </div>
      </div>
    ) : null;

  return (
    <McpCard
      isReadOnly
      icon={<AtlassianIcon className="size-8" />}
      config={configLocal}
      healthInfo={healthInfo}
      onConnect={handleOnConnect}
      onDisconnect={handleOnDisconnect}
      onTools={onTools}
      viewMode={viewMode}
      extraContent={prerequisiteSection}
    />
  );
}
