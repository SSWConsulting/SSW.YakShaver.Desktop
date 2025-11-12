import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { formatErrorMessage } from "@/utils";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body?: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
}

interface ReleaseChannel {
  type: "latest" | "prerelease" | "tag";
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

  const loadChannel = useCallback(async () => {
    try {
      const currentChannel = await window.electronAPI.releaseChannel.get();
      if (currentChannel.type === "prerelease") {
        setChannel({ type: "latest" });
      } else {
        setChannel(currentChannel);
      }
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

  useEffect(() => {
    if (isActive) {
      void loadChannel();
      void loadReleases();
      void loadCurrentVersion();
    }
  }, [isActive, loadChannel, loadReleases, loadCurrentVersion]);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    setUpdateStatus("");
    try {
      await window.electronAPI.releaseChannel.set(channel);

      // Show what channel was saved
      const channelDisplay =
        channel.type === "latest"
          ? "Latest"
          : channel.type === "tag"
            ? `PR Pre-release: ${channel.tag}`
            : channel.type;
      setUpdateStatus(`✅ Channel saved: ${channelDisplay}`);
      toast.success("Release channel updated successfully");
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      setUpdateStatus("❌ Failed to save channel");
      toast.error(`Failed to save release channel settings: ${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, [channel]);

  const handleCheckUpdates = useCallback(async () => {
    setIsLoading(true);
    setUpdateStatus("Checking for updates...");

    try {
      // Save the currently selected channel first before checking for updates
      // This ensures we check for updates on the selected release, not a previously saved one
      await window.electronAPI.releaseChannel.set(channel);

      // Show which channel we're checking
      const channelDisplay =
        channel.type === "latest"
          ? "Latest"
          : channel.type === "tag"
            ? `PR Pre-release: ${channel.tag}`
            : channel.type;
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
  }, [channel, currentVersion]);

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

  // Extract PR number from release body if available
  const getPRNumberFromRelease = (release: GitHubRelease): string | null => {
    // Look for "PR #123" in the release name or body
    const prMatch = release.name?.match(/PR #(\d+)/) || release.body?.match(/PR #(\d+)/);
    return prMatch ? prMatch[1] : null;
  };

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    const prereleases = releases.filter((release) => release.prerelease);
    
    if (prereleases.length === 0) {
      return [];
    }
    
    // Sort by published date (newest first)
    const sorted = prereleases.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
    
    // Show all PR builds with their PR numbers
    return sorted.map((release) => {
      const prNumber = getPRNumberFromRelease(release);
      
      const label = prNumber
        ? `PR #${prNumber}`
        : release.tag_name;

      return {
        value: release.tag_name,
        label: label,
        isPrerelease: release.prerelease,
        publishedAt: release.published_at,
      };
    });
  }, [releases]);

  return (
    <div className="flex flex-col gap-6">
      {currentVersion && (
        <div className="p-3 rounded-md border bg-white/5 border-white/10">
          <p className="text-sm text-white/60">
            Current Version
          </p>
          <p className="text-lg text-white">
            {currentVersion}
          </p>
        </div>
      )}

      {updateStatus && (
        <div className="p-3 bg-white/5 border-white/10">
          <p className="text-sm text-white">{updateStatus}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="release-select" className="text-white">
            Select Release Channel
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
                    <span className="text-xs">
                      {new Date(option.publishedAt).toLocaleString()}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <Button
          variant="outline"
          onClick={handleCheckUpdates}
          disabled={isLoading}
          className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-800/80 hover:text-white/80"
        >
          Check for Updates
        </Button>
        <Button
          variant="secondary"
          onClick={handleSave}
          disabled={isLoading || (channel.type === "tag" && !channel.tag)}
        >
          {isLoading ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

// Backwards compatibility wrapper (optional usage elsewhere)
export function ReleaseChannelManager() {
  return <ReleaseChannelSettingsPanel isActive />;
}
