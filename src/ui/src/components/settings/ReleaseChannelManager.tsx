import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
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
    try {
      await window.electronAPI.releaseChannel.set(channel);
      toast.success("Release channel updated successfully");
    } catch (error) {
      console.error("Failed to save release channel:", error);
      toast.error("Failed to save release channel settings");
    } finally {
      setIsLoading(false);
    }
  }, [channel]);

  const handleCheckUpdates = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.releaseChannel.checkUpdates();
      if (result.error) {
        toast.error(`Update check failed: ${result.error}`);
      } else if (result.available) {
        toast.success("Update available! The app will update automatically.");
      } else {
        toast.info("You are on the latest version");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      toast.error("Failed to check for updates");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
    const mapped = releases.map((release) => ({
      value: release.tag_name,
      label: release.name || release.tag_name,
      isPrerelease: release.prerelease,
      publishedAt: release.published_at,
    }));

    if (
      channel.type === "tag" &&
      channel.tag &&
      !mapped.some((option) => option.value === channel.tag)
    ) {
      mapped.unshift({
        value: channel.tag,
        label: channel.tag,
        isPrerelease: false,
        publishedAt: "",
      });
    }

    return mapped;
  }, [channel, releases]);

  return (
    <div className="flex flex-col gap-6">
      {currentVersion && (
        <div className="p-3 bg-white/5 rounded-md border border-white/10">
          <p className="text-sm text-white/60">Current Version</p>
          <p className="text-lg font-mono text-white">{currentVersion}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="release-select" className="text-white">
            Select Release
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
                  No releases available
                </SelectItem>
              )}
              {dropdownOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="text-white"
                  textValue={option.label}
                >
                  {option.label}
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
