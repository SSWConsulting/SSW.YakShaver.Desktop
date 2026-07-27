import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { SettingsSection } from "../SettingsSection";
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

  const loadReleases = useCallback(async () => {
    setIsLoadingReleases(true);
    try {
      const response = await ipcClient.releaseChannel.listReleases();
      if (response.error) {
        // Clear previously loaded releases so the dropdown matches the latest API result.
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

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadChannel();
    void loadCurrentVersion();
    void loadReleases();
  }, [isActive, loadChannel, loadReleases, loadCurrentVersion]);

  const handleCheckUpdates = useCallback(async () => {
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
  }, [channel, currentVersion, getChannelDisplay]);

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

  const handleSelectionChange = useCallback((value: string) => {
    if (value === "__loading" || value === "__empty") {
      return;
    }

    if (value === SELECT_LATEST) {
      setChannel({ type: "latest" });
      return;
    }

    setChannel({ type: "pr", channel: `beta.${value}` });
  }, []);

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    return releases.map((release) => ({
      value: release.prNumber,
      label: `PR #${release.prNumber}`,
      version: release.version,
      publishedAt: release.publishedAt,
    }));
  }, [releases]);

  return (
    <SettingsSection
      title="Release Channel"
      description="Choose the stable release or a PR release to test updates."
      contentClassName="space-y-4"
    >
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

        <Button onClick={handleCheckUpdates} disabled={isLoading || !selectValue}>
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
                <span className="text-sm text-muted-foreground">({BUMP_TYPE_LABEL[bumpType]})</span>
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
    </SettingsSection>
  );
}
