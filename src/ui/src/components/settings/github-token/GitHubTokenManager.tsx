import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { HealthStatusInfo } from "@/types";
import { formatErrorMessage } from "@/utils";
import { HealthStatus } from "../../health-status/health-status";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

interface GitHubTokenSettingsPanelProps {
  isActive: boolean;
}

export function GitHubTokenSettingsPanel({ isActive }: GitHubTokenSettingsPanelProps) {
  const [token, setToken] = useState<string>("");
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [showToken, setShowToken] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(null);
  const [verifyDetails, setVerifyDetails] = useState<{
    username?: string;
    scopes?: string[];
    rateLimitRemaining?: number;
  } | null>(null);

  const loadToken = useCallback(async () => {
    setIsLoading(true);
    try {
      const savedToken = await window.electronAPI.githubToken.get();
      const tokenExists = await window.electronAPI.githubToken.has();

      if (savedToken) {
        setToken(savedToken);
      }
      setHasToken(tokenExists);
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to load GitHub token: ${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthStatus((prev) => ({
      isHealthy: prev?.isHealthy ?? false,
      error: prev?.error,
      successMessage: prev?.successMessage,
      isChecking: true,
    }));
    try {
      const result = await window.electronAPI.githubToken.verify();
      if (result.isValid) {
        setHealthStatus({
          isHealthy: true,
          isChecking: false,
        });
        setVerifyDetails({
          username: result.username,
          scopes: result.scopes,
          rateLimitRemaining: result.rateLimitRemaining,
        });
      } else {
        setHealthStatus({
          isHealthy: false,
          error: result.error ?? "GitHub token is invalid",
          isChecking: false,
        });
        setVerifyDetails(null);
      }
    } catch (error) {
      setHealthStatus({
        isHealthy: false,
        error: formatErrorMessage(error),
        isChecking: false,
      });
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void loadToken();
    }
  }, [isActive, loadToken]);

  useEffect(() => {
    if (isActive && hasToken) {
      void checkHealth();
    }
  }, [isActive, hasToken, checkHealth]);

  const handleSave = useCallback(async () => {
    if (!token.trim()) {
      toast.error("Please enter a GitHub token");
      return;
    }

    setIsSaving(true);
    try {
      await window.electronAPI.githubToken.set(token.trim());
      setHasToken(true);
      toast.success("GitHub token saved successfully");
      await checkHealth();
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to save GitHub token: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [token, checkHealth]);

  const handleClear = useCallback(async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.githubToken.clear();
      setToken("");
      setHasToken(false);
      setShowToken(false);
      setHealthStatus(null);
      toast.success("GitHub token cleared successfully");
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to clear GitHub token: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const toggleShowToken = useCallback(() => {
    setShowToken((prev) => !prev);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {isLoading ? (
        <div className="text-muted-foreground text-center py-8">Loading...</div>
      ) : (
        <>
          {hasToken && (
            <div className="flex items-center gap-3">
              <p className="text-white/80 text-sm">Token Status:</p>
              <span className="text-green-400 text-sm font-mono">Saved</span>
              <HealthStatus
                isChecking={healthStatus?.isChecking ?? false}
                isHealthy={healthStatus?.isHealthy ?? false}
                successMessage={healthStatus?.successMessage}
                successDetails={verifyDetails ?? undefined}
                error={healthStatus?.error}
                isDisabled={!hasToken}
              />
            </div>
          )}
          {!hasToken && (
            <p className="text-white/80 text-sm">
              Status: <span className="text-ssw-red">No Token Saved</span>
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label>GitHub Personal Access Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? "Token is saved (hidden)" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
                disabled={isSaving}
              />
              {token && (
                <button
                  type="button"
                  onClick={toggleShowToken}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The token is encrypted and stored locally on your device
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            {hasToken && (
              <Button
                variant="destructive"
                onClick={handleClear}
                disabled={isSaving}
                className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-800/80 hover:text-white/80"
              >
                Clear Token
              </Button>
            )}
            <Button onClick={handleSave} disabled={isSaving || !token.trim()}>
              {isSaving ? "Saving..." : "Save Token"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
