import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { ExternalLink } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasAuthorizationHeader, useMcpCardActions } from "@/hooks/useMcpCardActions";
import type { HealthStatusInfo } from "../../../../../../backend/types";
import type { MCPServerConfig } from "../McpServerForm";
import { McpCard } from "../mcp-card";
import { GitHubIcon } from "./github-icon";

// Pre-fills a fine-grained token with a recognisable name; the user picks repos and permissions.
const CREATE_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=YakShaver%20MCP&description=YakShaver%20Desktop";

interface McpGitHubCardProps {
  config?: MCPServerConfig;
  onChange?: (config: MCPServerConfig) => void;
  healthInfo?: HealthStatusInfo | null;
  onTools?: () => void;
  viewMode: "compact" | "detailed";
}

McpGitHubCard.Name = "GitHub";
McpGitHubCard.Id = PRESET_SERVER_IDS.GITHUB;

export function McpGitHubCard({
  config,
  onChange,
  healthInfo,
  onTools,
  viewMode,
}: McpGitHubCardProps) {
  const configLocal = config ?? GITHUB_PRESET_CONFIG;
  const tokenInputId = useId();
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [token, setToken] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);

  const {
    handleOnConnect,
    handleOnDisconnect,
    handleOnReauthorize,
    handleOnConnectWithToken,
    handleOnDisconnectAndForgetToken,
  } = useMcpCardActions(McpGitHubCard.Id, configLocal, onChange);

  // #1062: a personal access token works without a YakShaver sign-in (the OAuth Connect needs one).
  const usesToken = hasAuthorizationHeader(configLocal);

  async function handleSubmitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken) return;

    setIsSavingToken(true);
    const saved = await handleOnConnectWithToken(trimmedToken);
    setIsSavingToken(false);
    if (saved) {
      setToken("");
      setShowTokenForm(false);
    }
  }

  const tokenSection = configLocal.enabled ? (
    usesToken && (
      <p className="mt-2 text-sm text-muted-foreground">Using a personal access token.</p>
    )
  ) : (
    <div className="mt-3">
      {showTokenForm ? (
        <form
          onSubmit={handleSubmitToken}
          className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/5 p-3"
        >
          <Label htmlFor={tokenInputId}>Personal access token</Label>
          <p className="text-sm leading-relaxed text-muted-foreground">
            No YakShaver account needed.{" "}
            <a
              href={CREATE_TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300"
            >
              Create a token <ExternalLink className="size-3" />
            </a>{" "}
            with Issues read and write access to the repositories YakShaver should use.
          </p>
          <Input
            id={tokenInputId}
            type="password"
            autoComplete="off"
            placeholder="github_pat_…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowTokenForm(false);
                setToken("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!token.trim() || isSavingToken}>
              Connect with token
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-sm text-muted-foreground"
          onClick={() => setShowTokenForm(true)}
        >
          Use a personal access token instead
        </Button>
      )}
    </div>
  );

  return (
    <McpCard
      isReadOnly
      icon={<GitHubIcon />}
      config={configLocal}
      healthInfo={healthInfo}
      onConnect={handleOnConnect}
      onDisconnect={usesToken ? handleOnDisconnectAndForgetToken : handleOnDisconnect}
      // Reauthorize reruns the backend OAuth; a rejected token is fixed by disconnecting and
      // entering a new one instead.
      onReauthorize={usesToken ? undefined : handleOnReauthorize}
      onTools={onTools}
      viewMode={viewMode}
      extraContent={tokenSection}
    />
  );
}
