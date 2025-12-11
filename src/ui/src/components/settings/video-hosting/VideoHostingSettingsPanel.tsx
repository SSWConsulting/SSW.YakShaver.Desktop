import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import type { VideoHostingSettings, VideoPlatform, VideoPrivacy } from "@/types";
import { Button } from "../../ui/button";
import { Card, CardContent } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

interface VideoHostingSettingsPanelProps {
  isActive: boolean;
}

const PLATFORMS: { value: VideoPlatform; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "vimeo", label: "Vimeo" },
  { value: "wistia", label: "Wistia" },
  { value: "custom", label: "Custom" },
];

const PRIVACY_OPTIONS: { value: VideoPrivacy; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
];

export function VideoHostingSettingsPanel({ isActive }: VideoHostingSettingsPanelProps) {
  const [settings, setSettings] = useState<VideoHostingSettings>({
    platform: "youtube",
    credentials: {},
    defaultPrivacy: "unlisted",
    defaultTags: [],
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [tagsInput, setTagsInput] = useState<string>("");

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await ipcClient.videoHostingSettings.get();
      setSettings(current);
      setTagsInput(current.defaultTags?.join(", ") || "");
    } catch (error) {
      console.error("Failed to load video hosting settings", error);
      toast.error("Failed to load video hosting settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadSettings();
  }, [isActive, loadSettings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Parse tags from input
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const updatedSettings = { ...settings, defaultTags: tags };
      await ipcClient.videoHostingSettings.set(updatedSettings);
      setSettings(updatedSettings);
      toast.success("Settings saved successfully");
    } catch (error) {
      console.error("Failed to save video hosting settings", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  }, [settings, tagsInput]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    try {
      const result = await ipcClient.videoHostingSettings.testConnection();
      if (result.success) {
        toast.success(result.message || "Connection test successful");
      } else {
        toast.error(result.error || "Connection test failed");
      }
    } catch (error) {
      console.error("Failed to test connection", error);
      toast.error("Failed to test connection");
    } finally {
      setIsTesting(false);
    }
  }, []);

  const updatePlatform = useCallback((platform: VideoPlatform) => {
    setSettings((prev) => ({ ...prev, platform }));
  }, []);

  const updatePrivacy = useCallback((privacy: VideoPrivacy) => {
    setSettings((prev) => ({ ...prev, defaultPrivacy: privacy }));
  }, []);

  const updateCredential = useCallback((key: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      credentials: { ...prev.credentials, [key]: value },
    }));
  }, []);

  const updateField = useCallback((key: keyof VideoHostingSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Video Hosting Platform</h2>
        <p className="text-sm text-white/70">
          Configure the video hosting platform for uploading and managing videos.
        </p>
      </div>

      <Card className="border-white/10">
        <CardContent className="px-6 py-6 space-y-6">
          {/* Platform Selection */}
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select value={settings.platform} onValueChange={updatePlatform} disabled={isLoading}>
              <SelectTrigger id="platform" className="w-full">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value}>
                    {platform.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Platform-specific credentials */}
          {settings.platform === "youtube" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="clientId">Client ID</Label>
                <Input
                  id="clientId"
                  type="text"
                  placeholder="Enter YouTube Client ID"
                  value={settings.credentials.clientId || ""}
                  onChange={(e) => updateCredential("clientId", e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Client Secret</Label>
                <Input
                  id="clientSecret"
                  type="password"
                  placeholder="Enter YouTube Client Secret"
                  value={settings.credentials.clientSecret || ""}
                  onChange={(e) => updateCredential("clientSecret", e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </>
          )}

          {settings.platform === "vimeo" && (
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter Vimeo API Key"
                value={settings.credentials.apiKey || ""}
                onChange={(e) => updateCredential("apiKey", e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {settings.platform === "wistia" && (
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter Wistia API Key"
                value={settings.credentials.apiKey || ""}
                onChange={(e) => updateCredential("apiKey", e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {settings.platform === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="customEndpoint">Custom Endpoint URL</Label>
              <Input
                id="customEndpoint"
                type="url"
                placeholder="https://your-video-platform.com/api/upload"
                value={settings.credentials.customEndpoint || ""}
                onChange={(e) => updateCredential("customEndpoint", e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Default Privacy */}
          <div className="space-y-2">
            <Label htmlFor="privacy">Default Privacy</Label>
            <Select
              value={settings.defaultPrivacy}
              onValueChange={updatePrivacy}
              disabled={isLoading}
            >
              <SelectTrigger id="privacy" className="w-full">
                <SelectValue placeholder="Select default privacy" />
              </SelectTrigger>
              <SelectContent>
                {PRIVACY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Default Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Default Tags</Label>
            <Input
              id="tags"
              type="text"
              placeholder="tag1, tag2, tag3"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-white/60">Separate tags with commas</p>
          </div>

          {/* Default Category (optional) */}
          <div className="space-y-2">
            <Label htmlFor="category">Default Category (Optional)</Label>
            <Input
              id="category"
              type="text"
              placeholder="e.g., Education, Entertainment"
              value={settings.defaultCategory || ""}
              onChange={(e) => updateField("defaultCategory", e.target.value)}
              disabled={isLoading}
            />
          </div>

          {/* Description Template (optional) */}
          <div className="space-y-2">
            <Label htmlFor="descriptionTemplate">Description Template (Optional)</Label>
            <textarea
              id="descriptionTemplate"
              className="w-full min-h-[100px] px-3 py-2 rounded-md border border-white/10 bg-black/20 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              placeholder="Enter a default description template..."
              value={settings.descriptionTemplate || ""}
              onChange={(e) => updateField("descriptionTemplate", e.target.value)}
              disabled={isLoading}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleSave}
              disabled={isLoading || isSaving}
              className="flex-1"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
            <Button
              onClick={handleTestConnection}
              disabled={isLoading || isTesting || isSaving}
              variant="outline"
              className="flex-1"
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
