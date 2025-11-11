import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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
      console.error("Failed to load release channel:", error);
      toast.error("Failed to load release channel settings");
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
      console.error("Failed to load releases:", error);
      toast.error("Failed to load releases");
    } finally {
      setIsLoadingReleases(false);
    }
  }, []);

  const loadCurrentVersion = useCallback(async () => {
    try {
      const version = await window.electronAPI.releaseChannel.getCurrentVersion();
      setCurrentVersion(version);
    } catch (error) {
      console.error("Failed to load current version:", error);
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
          ? "Latest Stable"
          : channel.type === "tag"
            ? `PR Release: ${channel.tag}`
            : channel.type;
      setUpdateStatus(`✅ Channel saved: ${channelDisplay}`);
      toast.success("Release channel updated successfully");
    } catch (error) {
      console.error("Failed to save release channel:", error);
      setUpdateStatus("❌ Failed to save channel");
      toast.error("Failed to save release channel settings");
    } finally {
      setIsLoading(false);
    }
  }, [channel]);

  const handleCheckUpdates = useCallback(async () => {
    setIsLoading(true);
    setUpdateStatus("Checking for updates...");

    try {
      console.log("Starting update check...");
      console.log("Current channel:", channel);

      // Show which channel we're checking
      const channelDisplay =
        channel.type === "latest"
          ? "Latest Stable"
          : channel.type === "tag"
            ? `PR Release: ${channel.tag}`
            : channel.type;
      setUpdateStatus(`Checking ${channelDisplay}...`);

      const result = await window.electronAPI.releaseChannel.checkUpdates();
      console.log("Update check result:", result);

      if (result.error) {
        console.error("Update error:", result.error);
        setUpdateStatus(`❌ Error: ${result.error}`);
        toast.error(`Update check failed: ${result.error}`);
      } else if (result.available) {
        console.log("Update available! Version:", result.version);
        setUpdateStatus(
          `✅ Update found: ${result.version || "unknown"} - Download will start automatically`,
        );
        toast.success(
          `Update available! Version ${result.version || "unknown"} will download automatically.`,
        );
      } else {
        console.log("No updates available");
        setUpdateStatus(`✅ You are on the latest version (${currentVersion})`);
        toast.info("You are on the latest version");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setUpdateStatus(`❌ Failed: ${errorMsg}`);
      toast.error("Failed to check for updates");
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

    // When selecting a tag (which is the full version like "0.3.7-beta.1731234567")
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
    // Since workflow now uses build timestamp, published_at matches version order
    const sorted = prereleases.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
    
    // Show all PR builds, but mark which one is the latest (what electron-updater will download)
    return sorted.map((release, index) => {
      const prNumber = getPRNumberFromRelease(release);
      const isLatest = index === 0; // First one is latest
      
      const label = prNumber
        ? `PR #${prNumber}${isLatest ? ' (Latest - will be downloaded)' : ''}`
        : `${release.tag_name}${isLatest ? ' (Latest)' : ''}`;

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
        <div
          className={`p-3 rounded-md border ${
            currentVersion.includes("beta")
              ? "bg-orange-500/10 border-orange-500/30"
              : "bg-white/5 border-white/10"
          }`}
        >
          <p
            className={`text-sm ${
              currentVersion.includes("beta") ? "text-orange-200" : "text-white/60"
            }`}
          >
            Current Version
            {currentVersion.includes("beta") && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded bg-orange-500/20 text-orange-300">
                BETA
              </span>
            )}
          </p>
          <p
            className={`text-lg font-mono ${
              currentVersion.includes("beta") ? "text-orange-100" : "text-white"
            }`}
          >
            {currentVersion}
          </p>
        </div>
      )}

      {updateStatus && (
        <div className="p-3 bg-blue-500/10 rounded-md border border-blue-500/30">
          <p className="text-sm text-blue-200">{updateStatus}</p>
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
                    <span className="text-xs text-white/50">
                      {new Date(option.publishedAt).toLocaleString()}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-white/50">
            ⚠️ Note: electron-updater always downloads the LATEST beta release (top of list), regardless of which PR you select. Multiple PRs may have beta builds.
          </p>
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
