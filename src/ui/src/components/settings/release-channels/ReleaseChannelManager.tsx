import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body?: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
}

type ReleaseChannelType = "latest" | "tag";
export interface ReleaseChannel {
  type: ReleaseChannelType;
  tag?: string;
}

const SELECT_LATEST = "channel:latest";

interface DropdownOption {
  value: string;
  label: string;
  isPrerelease: boolean;
  publishedAt: string;
}

interface ReleaseChannelSettingsPanelProps {
  isActive: boolean;
}

export function ReleaseChannelSettingsPanel({ isActive }: ReleaseChannelSettingsPanelProps) {
  const [channel, setChannel] = useState<ReleaseChannel>({ type: "latest" });
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [hasGitHubToken, setHasGitHubToken] = useState<boolean>(false);

  /**
   * Returns a user-friendly display string for the given release channel.
   * @param ch The release channel
   * @return The display string, e.g., "PR Pre-release: 0.3.7-beta.12.1762916882"
   */
  const getChannelDisplay = useCallback((ch: ReleaseChannel) => {
    if (ch.type === "latest") {
      return "Latest";
    }
    if (ch.type === "tag") {
      return `PR Pre-release: ${ch.tag}`;
    }
    return ch.type;
  }, []);

  /**
   * Extracts the PR number from a GitHub release's name or body, if available.
   * @param release The GitHub release object
   * @return The PR number as a string, or null if not found
   */
  const getPRNumberFromRelease = useCallback((release: GitHubRelease): string | null => {
    const prMatch = release.name?.match(/PR #(\d+)/) || release.body?.match(/PR #(\d+)/);
    return prMatch ? prMatch[1] : null;
  }, []);

  const loadChannel = useCallback(async () => {
    try {
      const currentChannel = await window.electronAPI.releaseChannel.get();
      setChannel(currentChannel);
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to load release channel settings: ${errMsg}`);
    }
  }, []);

  const loadReleases = useCallback(async () => {
    setIsLoadingReleases(true);
    try {
      const response = await window.electronAPI.releaseChannel.listReleases();
      if (response.error) {
        toast.error(`Failed to load releases: ${response.error}`);
      } else {
        setReleases(response.releases || []);
      }
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to load releases: ${errMsg}`);
    } finally {
      setIsLoadingReleases(false);
    }
  }, []);

  const loadCurrentVersion = useCallback(async () => {
    try {
      const version = await window.electronAPI.releaseChannel.getCurrentVersion();
      setCurrentVersion(version);
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      toast.error(`Failed to load current version: ${errMsg}`);
    }
  }, []);

  const checkGitHubToken = useCallback(async () => {
    try {
      const tokenExists = await window.electronAPI.githubToken.has();
      setHasGitHubToken(tokenExists);
    } catch (error) {
      console.error("Failed to check GitHub token:", error);
      setHasGitHubToken(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      void loadChannel();
      void loadReleases();
      void loadCurrentVersion();
      void checkGitHubToken();
    }
  }, [isActive, loadChannel, loadReleases, loadCurrentVersion, checkGitHubToken]);

  const handleCheckUpdates = useCallback(async () => {
    setIsLoading(true);
    setUpdateStatus("Checking for updates...");

    try {
      // Save the currently selected channel first before checking for updates
      // This ensures we check for updates on the selected release, not a previously saved one
      await window.electronAPI.releaseChannel.set(channel);

      const channelDisplay = getChannelDisplay(channel);
      setUpdateStatus(`Checking ${channelDisplay}...`);

      const result = await window.electronAPI.releaseChannel.checkUpdates();

      if (result.error) {
        setUpdateStatus(`❌ Error: ${result.error}`);
        toast.error(`Update check failed: ${result.error}`);
      } else if (result.available) {
        setUpdateStatus(
          `✅ Update found: ${result.version || "unknown"} - Download will start automatically`,
        );
        toast.success(
          `Update available! Version ${result.version || "unknown"} will download automatically.`,
        );
      } else {
        setUpdateStatus(`✅ You are on the latest version (${currentVersion})`);
        toast.info("You are on the latest version");
      }
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      setUpdateStatus(`❌ Failed: ${errMsg}`);
      toast.error(`Failed to check for updates: ${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, [channel, currentVersion, getChannelDisplay]);

  const selectValue = useMemo(() => {
    if (channel.type === "latest") {
      return SELECT_LATEST;
    }
    return channel.tag ?? "";
  }, [channel]);

  const handleSelectionChange = useCallback((value: string) => {
    if (value === "__loading" || value === "__empty") {
      return;
    }
    if (value === SELECT_LATEST) {
      setChannel({ type: "latest" });
      return;
    }
    setChannel({ type: "tag", tag: value });
  }, []);

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    const prereleases = releases.filter((release) => release.prerelease);

    if (prereleases.length === 0) {
      return [];
    }

    // Sort by published date (newest first)
    const sorted = prereleases.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );

    // Show all PR builds with their PR numbers
    return sorted.map((release) => {
      const prNumber = getPRNumberFromRelease(release);

      const label = prNumber ? `PR #${prNumber}` : release.tag_name;

      return {
        value: release.tag_name,
        label: label,
        isPrerelease: release.prerelease,
        publishedAt: release.published_at,
      };
    });
  }, [releases, getPRNumberFromRelease]);

  return (
    <div className="flex flex-col gap-6">
      {!hasGitHubToken && (
        <div className="p-4 bg-yellow-500/10 rounded-md border border-yellow-500/30">
          <h3 className="text-yellow-200 font-medium mb-2">GitHub Token Required</h3>
          <p className="text-yellow-100 text-sm">
            A GitHub token is required to view and download PR releases. Configure it in the{" "}
            <b>GitHub Token</b> tab.
          </p>
        </div>
      )}

      {currentVersion && (
        <div className="p-3 rounded-md border bg-white/5 border-white/10">
          <p className="text-sm text-white/60">Current Version</p>
          <p className="text-lg text-white">{currentVersion}</p>
        </div>
      )}

      {updateStatus && (
        <div className="p-3 bg-white/5 border border-white/10">
          <p className="text-sm text-white">{updateStatus}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="release-select" className="text-white">
            Select Release Channel To Test
          </Label>
          <Select value={selectValue} onValueChange={handleSelectionChange}>
            <SelectTrigger className="bg-white/5 border-white/20 text-white">
              <SelectValue placeholder="Choose a release" />
            </SelectTrigger>
            <SelectContent className="bg-neutral-800 border-neutral-700 max-h-80">
              <SelectItem
                value={SELECT_LATEST}
                className="text-white"
                textValue="Latest Stable (default)"
              >
                Latest Stable (default)
              </SelectItem>
              {isLoadingReleases && (
                <SelectItem value="__loading" disabled className="text-white/60">
                  Loading releases...
                </SelectItem>
              )}
              {!isLoadingReleases && dropdownOptions.length === 0 && (
                <SelectItem value="__empty" disabled className="text-white/60">
                  No PR releases available
                </SelectItem>
              )}
              {dropdownOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-white"
                  textValue={option.label}
                >
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-xs">{new Date(option.publishedAt).toLocaleString()}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <Button
          variant="secondary"
          onClick={handleCheckUpdates}
          disabled={isLoading || !hasGitHubToken}
        >
          Check for Updates
        </Button>
      </div>
    </div>
  );
}
