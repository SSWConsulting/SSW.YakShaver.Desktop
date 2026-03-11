import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { HealthStatus } from "@/components/health-status/health-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipcClient } from "@/services/ipc-client";
import type { HealthStatusInfo } from "@/types";
import { formatErrorMessage } from "@/utils";
import type { MCPServerConfig } from "../McpServerForm";
import { Atlassian } from "./atlassian";

const JIRA_MCP_PATH = "/rest/mcp/1.0/sse";

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function buildJiraUrl(domain: string): string {
  return `https://${normalizeDomain(domain)}${JIRA_MCP_PATH}`;
}

function getDomainFromConfig(config: MCPServerConfig | undefined): string {
  if (config?.transport !== "streamableHttp" || !config.url) return "";
  try {
    return new URL(config.url).hostname;
  } catch {
    return "";
  }
}

function validateJiraDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) return "Jira domain is required";
  const cleanDomain = normalizeDomain(trimmed);
  try {
    new URL(`https://${cleanDomain}`);
  } catch {
    return "Please enter a valid domain (e.g., your-company.atlassian.net)";
  }
  if (!cleanDomain.includes(".")) {
    return "Please enter a valid domain (e.g., your-company.atlassian.net)";
  }
  return null;
}

interface McpJiraCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpJiraCard.Name = "Jira";
McpJiraCard.Id = "0f03a50c-219b-46e9-9ce3-54f925c44479";

export function McpJiraCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpJiraCardProps) {
  const configLocal: MCPServerConfig = config ?? {
    id: McpJiraCard.Id,
    name: McpJiraCard.Name,
    transport: "streamableHttp",
    url: "",
    description: "Jira MCP Server",
    toolWhitelist: [],
    enabled: false,
  };

  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState(getDomainFromConfig(config));
  const [domainError, setDomainError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const savedDomain = getDomainFromConfig(config);
  const hasDomain = Boolean(savedDomain);

  async function handleSave(): Promise<void> {
    const error = validateJiraDomain(domain);
    if (error) {
      setDomainError(error);
      return;
    }
    setDomainError(null);
    try {
      const updatedConfig: MCPServerConfig = {
        ...configLocal,
        url: buildJiraUrl(domain),
        enabled: false,
      };
      await ipcClient.mcp.updateServerAsync(McpJiraCard.Id, updatedConfig);
      setShowForm(false);
      onChange?.(updatedConfig);
    } catch (error) {
      toast.error(`Failed to save: ${formatErrorMessage(error)}`);
    }
  }

  async function toggleEnabled(status: boolean): Promise<void> {
    try {
      const updatedConfig = { ...configLocal, enabled: status };
      await ipcClient.mcp.updateServerAsync(McpJiraCard.Id, updatedConfig);
      onChange?.(updatedConfig);
    } catch (error) {
      toast.error(`Failed to update: ${formatErrorMessage(error)}`);
    }
  }

  async function handleOnDisconnect(): Promise<void> {
    try {
      await ipcClient.mcp.clearTokensAsync(McpJiraCard.Id);
      await toggleEnabled(false);
    } catch (error) {
      toast.error(`Failed to disconnect: ${formatErrorMessage(error)}`);
    }
  }

  function handleCopyDomain(): void {
    const domainToCopy = `https://${normalizeDomain(domain)}`;
    navigator.clipboard.writeText(domainToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Domain copied to clipboard");
  }

  function handleCardClick(): void {
    if (!showForm) setShowForm(true);
  }

  function handleCancel(): void {
    setDomain(savedDomain);
    setDomainError(null);
    setShowForm(false);
  }

  return (
    <div className="flex flex-col rounded-lg border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.04)] pt-4 pr-6 pb-4 pl-6 opacity-100 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.08)] hover:border-white/40">
      {/* biome-ignore lint: keyboard navigation not yet supported */}
      <div
        className={`flex items-center justify-between w-full ${showForm ? "" : "cursor-pointer"}`}
        onClick={handleCardClick}
      >
        <div className="flex items-center">
          {healthInfo && (
            <HealthStatus
              isChecking={healthInfo.isChecking}
              isDisabled={!configLocal.enabled}
              isHealthy={healthInfo.isHealthy}
              successMessage={healthInfo.successMessage}
              className="mr-4"
            />
          )}
          <span className="size-8 flex items-center justify-center">
            <Atlassian className="size-8" />
          </span>
          <div className="flex flex-col ml-4">
            <span className="text-base font-medium">Jira</span>
            <span className="text-sm text-gray-400">Jira MCP Server</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === "detailed" && onTools && configLocal.enabled && (
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onTools();
              }}
            >
              Tools
            </Button>
          )}
          {!configLocal.enabled && (
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                if (!hasDomain) {
                  setShowForm(true);
                } else {
                  toggleEnabled(true);
                }
              }}
            >
              {hasDomain ? "Connect" : "Configure"}
            </Button>
          )}
          {configLocal.enabled && (
            <Button
              variant="destructiveOutline"
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                handleOnDisconnect();
              }}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        // biome-ignore lint: stop propagation prevents parent click
        <div className="mt-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-white">
              Jira Domain <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Enter your Atlassian cloud domain. This is the base URL of your Jira instance (e.g.,{" "}
              <code className="text-xs">https://your-company.atlassian.net</code>).
            </p>
            <Input
              type="text"
              placeholder="https://your-company.atlassian.net"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setDomainError(null);
              }}
            />
            {domainError && <p className="text-xs text-red-400">{domainError}</p>}
          </div>

          {domain.trim() && !domainError && (
            <div className="flex flex-col gap-1.5 rounded-md bg-white/5 border border-white/10 p-3">
              <p className="text-xs text-muted-foreground">
                Add this domain to your Jira organization settings:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-blue-300 flex-1 truncate">
                  https://{normalizeDomain(domain)}
                </code>
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
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!domain.trim()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
