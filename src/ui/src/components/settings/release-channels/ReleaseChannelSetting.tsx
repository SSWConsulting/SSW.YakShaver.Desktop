import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage, getVersionBumpType, type VersionBumpType } from "@/utils";
import { GITHUB_TOKEN_UPDATED_EVENT } from "./GitHubTokenSetting";
import type { ProcessedRelease, ReleaseChannel } from "./types";

interface ReleaseChannelSettingProps {
  isActive: boolean;
}

interface DropdownOption {
  value: string;
  label: string;
  version: string;
  publishedAt: string;
}

const SELECT_LATEST = "channel:latest";

const BUMP_TYPE_LABEL: Record<VersionBumpType, string> = {
  major: "Major update",
  minor: "Minor update",
  patch: "Patch update",
  prerelease: "Pre-release update",
  downgrade: "Downgrade",
  unknown: "Update",
};

export function ReleaseChannelSetting({ isActive }: ReleaseChannelSettingProps) {
  const selectId = useId();
  const [channel, setChannel] = useState<ReleaseChannel>({ type: "latest" });
  const [releases, setReleases] = useState<ProcessedRelease[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [availableVersion, setAvailableVersion] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [hasGitHubToken, setHasGitHubToken] = useState<boolean>(false);
  // #919 — PR releases require a *valid* (healthy) token, not merely a saved one. An invalid or
  // expired token must not allow listing/selecting/downloading PR builds.
  const [isTokenHealthy, setIsTokenHealthy] = useState<boolean>(false);
  const [isCheckingToken, setIsCheckingToken] = useState<boolean>(true);
  // Reason the last verification failed (e.g. "Invalid or expired token", a network error message,
  // "Rate limit exceeded") — used so the banner doesn't always say "invalid or expired" even when
  // the real cause was a network/offline failure.
  const [tokenHealthError, setTokenHealthError] = useState<string | undefined>(undefined);

  const bumpType = useMemo(
    () => getVersionBumpType(currentVersion, availableVersion),
    [currentVersion, availableVersion],
  );

  const getChannelDisplay = useCallback((currentChannel: ReleaseChannel) => {
    if (currentChannel.type === "latest") {
      return "Latest";
    }

    if (currentChannel.type === "pr" && currentChannel.channel) {
      const prMatch = currentChannel.channel.match(/beta\.(\d+)/);
      return prMatch ? `PR #${prMatch[1]}` : `PR Pre-release: ${currentChannel.channel}`;
    }

    return currentChannel.type;
  }, []);

  const loadChannel = useCallback(async () => {
    try {
      const currentChannel = await ipcClient.releaseChannel.get();
      setChannel(currentChannel);
    } catch (error) {
      toast.error(`Failed to load release channel settings: ${formatErrorMessage(error)}`);
    }
  }, []);

  const loadReleases = useCallback(async (hasToken: boolean) => {
    // listReleases() always requires a healthy GitHub token on the backend (#919) — a user who
    // has never configured one will always get a "token required" error here, which the
    // dedicated no-token banner below already communicates. Skip the network call (and the
    // redundant toast) entirely in that case rather than spending rate-limit budget and noise on
    // every Settings-tab mount (review on #919); still call it once a token exists so PR release
    // data loads normally.
    if (!hasToken) {
      setReleases([]);
      return;
    }

    setIsLoadingReleases(true);
    try {
      const response = await ipcClient.releaseChannel.listReleases();
      if (response.error) {
        // Clear any previously-loaded releases (review on #939) — otherwise a token that was
        // healthy earlier and later becomes invalid/unreachable leaves stale, now-unselectable PR
        // entries lingering in the dropdown instead of an empty list matching the error state.
        setReleases([]);
        toast.error(`Failed to load releases: ${response.error}`);
      } else {
        setReleases(response.releases || []);
      }
    } catch (error) {
      setReleases([]);
      toast.error(`Failed to load releases: ${formatErrorMessage(error)}`);
    } finally {
      setIsLoadingReleases(false);
    }
  }, []);

  const loadCurrentVersion = useCallback(async () => {
    try {
      const info = await ipcClient.releaseChannel.getCurrentVersion();
      setCurrentVersion(info.version);
    } catch (error) {
      toast.error(`Failed to load current version: ${formatErrorMessage(error)}`);
    }
  }, []);

  // Returns whether a token exists so callers can decide whether it's worth calling
  // loadReleases() at all (review on #919) — the caller awaits this before loadReleases() rather
  // than firing both in parallel, so the no-token skip in loadReleases() has an answer to check.
  const checkGitHubToken = useCallback(async (): Promise<boolean> => {
    setIsCheckingToken(true);
    try {
      const tokenExists = await ipcClient.githubToken.has();
      setHasGitHubToken(tokenExists);

      if (!tokenExists) {
        setIsTokenHealthy(false);
        setTokenHealthError(undefined);
        return false;
      }

      // A saved token isn't necessarily a *valid* one (#919) — verify it against GitHub before
      // treating PR releases as usable.
      const verification = await ipcClient.githubToken.verify();
      setIsTokenHealthy(verification.isValid);
      setTokenHealthError(verification.isValid ? undefined : verification.error);
      return true;
    } catch (error) {
      console.error("Failed to check GitHub token:", error);
      setHasGitHubToken(false);
      setIsTokenHealthy(false);
      setTokenHealthError(undefined);
      return false;
    } finally {
      setIsCheckingToken(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadChannel();
    void loadCurrentVersion();
    // Resolve token state first so loadReleases() knows whether it's worth calling at all —
    // avoids spending rate-limit budget and a redundant error toast for a never-configured token
    // (review on #919).
    void checkGitHubToken().then((hasToken) => loadReleases(hasToken));
  }, [isActive, loadChannel, loadReleases, loadCurrentVersion, checkGitHubToken]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleGitHubTokenUpdate = () => {
      void checkGitHubToken().then((hasToken) => loadReleases(hasToken));
    };

    window.addEventListener(GITHUB_TOKEN_UPDATED_EVENT, handleGitHubTokenUpdate);
    return () => window.removeEventListener(GITHUB_TOKEN_UPDATED_EVENT, handleGitHubTokenUpdate);
  }, [isActive, checkGitHubToken, loadReleases]);

  const handleCheckUpdates = useCallback(async () => {
    if (channel.type === "pr" && !isTokenHealthy) {
      // Belt-and-braces: the button is already disabled in this state, but guard the handler too
      // in case it's ever reachable another way (#919).
      toast.error("A valid GitHub token is required to check for PR releases.");
      return;
    }

    setIsLoading(true);
    setUpdateStatus("Checking for updates...");
    setAvailableVersion("");

    try {
      await ipcClient.releaseChannel.set(channel);

      const channelDisplay = getChannelDisplay(channel);
      setUpdateStatus(`Checking ${channelDisplay}...`);

      const result = await ipcClient.releaseChannel.checkUpdates();
      // Sync `currentVersion` state from the authoritative result so the version
      // card's bump label (which reads `currentVersion` state) and this toast/status
      // label always agree, even if `loadCurrentVersion()` hadn't resolved yet.
      const effectiveCurrentVersion = result.currentVersion || currentVersion;
      if (result.currentVersion && result.currentVersion !== currentVersion) {
        setCurrentVersion(result.currentVersion);
      }

      if (result.error) {
        setUpdateStatus(`Error: ${result.error}`);
        toast.error(`Update check failed: ${result.error}`);
      } else if (result.available) {
        const newVersion = result.version || "unknown";
        setAvailableVersion(newVersion);
        const bump = getVersionBumpType(effectiveCurrentVersion, newVersion);
        const bumpLabel = BUMP_TYPE_LABEL[bump];
        setUpdateStatus(
          `${bumpLabel} available: ${effectiveCurrentVersion || "current"} → ${newVersion} - Download will start automatically`,
        );
        toast.success(
          `${bumpLabel} available: ${effectiveCurrentVersion || "current"} → ${newVersion}. Download will start automatically.`,
        );
      } else {
        setUpdateStatus(`You are on the latest version (${effectiveCurrentVersion})`);
        toast.info("You are on the latest version");
      }
    } catch (error) {
      const message = formatErrorMessage(error);
      setUpdateStatus(`Failed: ${message}`);
      toast.error(`Failed to check for updates: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, [channel, currentVersion, getChannelDisplay, isTokenHealthy]);

  const selectValue = useMemo(() => {
    if (channel.type === "latest") {
      return SELECT_LATEST;
    }

    if (channel.type === "pr" && channel.channel) {
      const prMatch = channel.channel.match(/beta\.(\d+)/);
      return prMatch ? prMatch[1] : "";
    }

    return "";
  }, [channel]);

  const handleSelectionChange = useCallback(
    (value: string) => {
      if (value === "__loading" || value === "__empty") {
        return;
      }

      if (value === SELECT_LATEST) {
        setChannel({ type: "latest" });
        return;
      }

      // PR channels require a healthy token (#919) — refuse the selection rather than letting the
      // user pick a channel that can't actually be checked/downloaded.
      if (!isTokenHealthy) {
        toast.error("A valid GitHub token is required to select a PR release.");
        return;
      }

      setChannel({ type: "pr", channel: `beta.${value}` });
    },
    [isTokenHealthy],
  );

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    return releases.map((release) => ({
      value: release.prNumber,
      label: `PR #${release.prNumber}`,
      version: release.version,
      publishedAt: release.publishedAt,
    }));
  }, [releases]);

  const showInvalidTokenBanner = !isCheckingToken && hasGitHubToken && !isTokenHealthy;
  const showNoTokenBanner = !isCheckingToken && !hasGitHubToken;
  // Only "Latest Stable" is selectable without a healthy token; PR entries are disabled below.
  // Fail closed while the check is in flight (isTokenHealthy starts false) rather than fail open —
  // otherwise PR entries would briefly render enabled before the first verification completes.
  const prSelectionDisabled = isCheckingToken || !isTokenHealthy;

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle>Release Channel</CardTitle>
        <CardDescription>
          Choose the stable release or a PR release to test updates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        {showNoTokenBanner && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
            <h3 className="mb-1 font-medium text-yellow-200">GitHub Token Required</h3>
            <p className="text-sm text-yellow-100">
              A GitHub token is required to view and download PR releases. Add one below.
            </p>
          </div>
        )}

        {showInvalidTokenBanner && (
          <div className="rounded-md border border-ssw-red/30 bg-ssw-red/10 p-3">
            <h3 className="mb-1 font-medium text-red-200">GitHub Token Invalid</h3>
            <p className="text-sm text-red-100">
              {tokenHealthError
                ? `GitHub token verification failed: ${tokenHealthError}. PR releases can't be listed, selected, or downloaded until this is resolved.`
                : "Your GitHub token is invalid or expired, so PR releases can't be listed, selected, or downloaded. Update it below."}
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor={selectId}>Select Release Channel To Test</Label>
            <Select value={selectValue} onValueChange={handleSelectionChange}>
              <SelectTrigger id={selectId}>
                <SelectValue placeholder="Choose a release">
                  {selectValue === SELECT_LATEST
                    ? "Latest Stable (default)"
                    : selectValue
                      ? `PR #${selectValue}`
                      : "Choose a release"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={SELECT_LATEST} textValue="Latest Stable (default)">
                  Latest Stable (default)
                </SelectItem>
                {isLoadingReleases && (
                  <SelectItem value="__loading" disabled>
                    Loading releases...
                  </SelectItem>
                )}
                {!isLoadingReleases && dropdownOptions.length === 0 && (
                  <SelectItem value="__empty" disabled>
                    No PR releases available
                  </SelectItem>
                )}
                {!isLoadingReleases &&
                  dropdownOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-white"
                      textValue={option.label}
                      disabled={prSelectionDisabled}
                    >
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-xs">{option.version}</span>
                        <span className="text-xs">
                          {new Date(option.publishedAt).toLocaleString()}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleCheckUpdates}
            disabled={
              isLoading ||
              !selectValue ||
              (channel.type === "pr" ? !isTokenHealthy : !hasGitHubToken)
            }
          >
            Check for Updates
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {currentVersion && (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-sm text-muted-foreground">Current Version</p>
              <p className="text-lg">{currentVersion}</p>
            </div>
          )}

          {availableVersion && (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-sm text-muted-foreground">New Version Available</p>
              <p className="text-lg">
                {availableVersion}{" "}
                {bumpType !== "unknown" && (
                  <span className="text-sm text-muted-foreground">
                    ({BUMP_TYPE_LABEL[bumpType]})
                  </span>
                )}
              </p>
            </div>
          )}

          {updateStatus && (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-sm">{updateStatus}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
