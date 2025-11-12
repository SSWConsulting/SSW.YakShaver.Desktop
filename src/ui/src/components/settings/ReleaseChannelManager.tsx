/// <reference path="../../services/ipc-client.ts" />
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";

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

export function ReleaseChannelManager() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [channel, setChannel] = useState<ReleaseChannel>({ type: "latest" });
    const [releases, setReleases] = useState<GitHubRelease[]>([]);
    const [currentVersion, setCurrentVersion] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingReleases, setIsLoadingReleases] = useState(false);

    const loadChannel = useCallback(async () => {
        try {
            const currentChannel = await window.electronAPI.releaseChannel.get();
            setChannel(currentChannel);
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
        if (dialogOpen) {
            void loadChannel();
            void loadReleases();
            void loadCurrentVersion();
        }
    }, [dialogOpen, loadChannel, loadReleases, loadCurrentVersion]);

    const handleSave = useCallback(async () => {
        setIsLoading(true);
        try {
            await window.electronAPI.releaseChannel.set(channel);
            toast.success("Release channel updated successfully");
            setDialogOpen(false);
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

    const handleChannelTypeChange = useCallback(
        (type: "latest" | "prerelease" | "tag") => {
            setChannel((prev) => ({
                type,
                tag: type === "tag" ? prev.tag : undefined,
            }));
        },
        [],
    );

    const handleTagChange = useCallback((tag: string) => {
        setChannel((prev) => ({ ...prev, tag }));
    }, []);

    // Filter releases based on channel type
    const filteredReleases = releases.filter((release) => {
        if (channel.type === "latest") {
            return !release.prerelease;
        }
        if (channel.type === "prerelease") {
            return release.prerelease;
        }
        return true; // Show all for tag selection
    });

    // Get available tags for selection
    const availableTags = releases.map((r) => r.tag_name).filter(Boolean);

    return (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
                <Button variant="secondary">Release Channel</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-neutral-900 text-neutral-100 border-neutral-800">
                <DialogHeader>
                    <DialogTitle className="text-white text-xl">Release Channel Settings</DialogTitle>
                    <DialogDescription className="text-white/80 text-sm">
                        Select which release channel to use for updates. You can choose the latest stable
                        release, pre-releases, or a specific version tag.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-6 mt-4">
                    {currentVersion && (
                        <div className="p-3 bg-white/5 rounded-md border border-white/10">
                            <p className="text-sm text-white/60">Current Version</p>
                            <p className="text-lg font-mono text-white">{currentVersion}</p>
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="channel-type" className="text-white">
                                Release Channel
                            </Label>
                            <Select
                                value={channel.type}
                                onValueChange={(value) =>
                                    handleChannelTypeChange(value as "latest" | "prerelease" | "tag")
                                }
                            >
                                <SelectTrigger
                                    id="channel-type"
                                    className="bg-white/5 border-white/20 text-white"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-neutral-800 border-neutral-700">
                                    <SelectItem value="latest" className="text-white focus:bg-neutral-700">
                                        Latest Stable
                                    </SelectItem>
                                    <SelectItem value="prerelease" className="text-white focus:bg-neutral-700">
                                        Pre-releases
                                    </SelectItem>
                                    <SelectItem value="tag" className="text-white focus:bg-neutral-700">
                                        Specific Tag
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {channel.type === "tag" && (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="tag-select" className="text-white">
                                    Select Tag
                                </Label>
                                <Select
                                    value={channel.tag || ""}
                                    onValueChange={handleTagChange}
                                    disabled={isLoadingReleases || availableTags.length === 0}
                                >
                                    <SelectTrigger
                                        id="tag-select"
                                        className="bg-white/5 border-white/20 text-white"
                                    >
                                        <SelectValue placeholder="Select a tag..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-neutral-800 border-neutral-700 max-h-60">
                                        {availableTags.map((tag) => (
                                            <SelectItem
                                                key={tag}
                                                value={tag}
                                                className="text-white focus:bg-neutral-700"
                                            >
                                                {tag}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {isLoadingReleases && (
                                    <p className="text-xs text-white/60">Loading releases...</p>
                                )}
                                {!isLoadingReleases && availableTags.length === 0 && (
                                    <p className="text-xs text-white/60">No releases available</p>
                                )}
                            </div>
                        )}

                        {channel.type === "latest" && (
                            <div className="p-3 bg-blue-500/10 rounded-md border border-blue-500/30">
                                <p className="text-sm text-white/80">
                                    You will receive stable releases only. This is the recommended option for most
                                    users.
                                </p>
                            </div>
                        )}

                        {channel.type === "prerelease" && (
                            <div className="p-3 bg-yellow-500/10 rounded-md border border-yellow-500/30">
                                <p className="text-sm text-white/80">
                                    You will receive pre-releases including PR builds. These may be less stable than
                                    stable releases.
                                </p>
                            </div>
                        )}

                        {channel.type === "tag" && channel.tag && (
                            <div className="p-3 bg-purple-500/10 rounded-md border border-purple-500/30">
                                <p className="text-sm text-white/80">
                                    You will receive updates for the selected tag: <strong>{channel.tag}</strong>
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-medium text-white">Available Releases</h3>
                        <div className="max-h-48 overflow-y-auto border border-white/10 rounded-md p-2 bg-black/20">
                            {isLoadingReleases ? (
                                <p className="text-sm text-white/60 p-4 text-center">Loading releases...</p>
                            ) : filteredReleases.length === 0 ? (
                                <p className="text-sm text-white/60 p-4 text-center">No releases found</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {filteredReleases.slice(0, 10).map((release) => (
                                        <div
                                            key={release.id}
                                            className="p-2 bg-white/5 rounded border border-white/10 hover:bg-white/10 transition-colors"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-white">
                                                            {release.name || release.tag_name}
                                                        </span>
                                                        {release.prerelease && (
                                                            <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded border border-yellow-500/30">
                                                                Pre-release
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-white/60 font-mono">
                                                        {release.tag_name}
                                                    </span>
                                                    <span className="text-xs text-white/50">
                                                        {new Date(release.published_at).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                        <Button
                            variant="outline"
                            onClick={handleCheckUpdates}
                            disabled={isLoading}
                            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                        >
                            Check for Updates
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isLoading || (channel.type === "tag" && !channel.tag)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            {isLoading ? "Saving..." : "Save"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

