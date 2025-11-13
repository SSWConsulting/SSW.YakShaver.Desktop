import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
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

  useEffect(() => {
    if (isActive) {
      void loadToken();
    }
  }, [isActive, loadToken]);

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
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to save GitHub token: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  }, [token]);

  const handleClear = useCallback(async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.githubToken.clear();
      setToken("");
      setHasToken(false);
      setShowToken(false);
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
        <div className="text-white/60 text-center py-8">Loading...</div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="github-token" className="text-white">
              GitHub Personal Access Token
            </Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? "Token is saved (hidden)" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
                className="bg-white/5 border-white/20 text-white pr-10"
                disabled={isSaving}
              />
              {token && (
                <button
                  type="button"
                  onClick={toggleShowToken}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            <p className="text-xs text-white/60">
              The token is encrypted and stored locally on your device
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            {hasToken && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={isSaving}
                className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-800/80 hover:text-white/80"
              >
                Clear Token
              </Button>
            )}
            <Button variant="secondary" onClick={handleSave} disabled={isSaving || !token.trim()}>
              {isSaving ? "Saving..." : "Save Token"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
