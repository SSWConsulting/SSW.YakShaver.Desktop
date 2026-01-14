import type { KeyboardShortcutSettings } from "@shared/types/keyboard-shortcuts";
import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { Button } from "../../ui/button";
import { Card, CardContent } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Switch } from "../../ui/switch";

interface KeyboardShortcutSettingsPanelProps {
  isActive: boolean;
}

export function KeyboardShortcutSettingsPanel({ isActive }: KeyboardShortcutSettingsPanelProps) {
  const [settings, setSettings] = useState<KeyboardShortcutSettings>({
    recordShortcut: "F12",
    autoLaunchEnabled: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [shortcutInput, setShortcutInput] = useState<string>("");
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await ipcClient.keyboardShortcut.get();
      setSettings(current);
      setShortcutInput(current.recordShortcut);
    } catch (error) {
      console.error("Failed to load keyboard shortcut settings", error);
      toast.error("Failed to load keyboard shortcut settings");
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

  const handleShortcutSave = useCallback(async () => {
    if (!shortcutInput.trim()) {
      toast.error("Shortcut cannot be empty");
      return;
    }

    setIsSaving(true);
    try {
      await ipcClient.keyboardShortcut.set(shortcutInput);
      setSettings((prev) => ({ ...prev, recordShortcut: shortcutInput }));
      toast.success(`Record shortcut updated to ${shortcutInput}`);
    } catch (error) {
      console.error("Failed to update record shortcut", error);
      toast.error("Failed to update record shortcut");
    } finally {
      setIsSaving(false);
    }
  }, [shortcutInput]);

  const handleAutoLaunchToggle = useCallback(async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await ipcClient.keyboardShortcut.setAutoLaunch(enabled);
      setSettings((prev) => ({ ...prev, autoLaunchEnabled: enabled }));
      toast.success(enabled ? "Auto-launch enabled" : "Auto-launch disabled");
    } catch (error) {
      console.error("Failed to update auto-launch setting", error);
      toast.error("Failed to update auto-launch setting");
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const key = e.key;

    // Build shortcut string
    let shortcut = "";
    if (e.ctrlKey) shortcut += "Ctrl+";
    if (e.altKey) shortcut += "Alt+";
    if (e.shiftKey) shortcut += "Shift+";
    if (e.metaKey) shortcut += "Command+";

    // Add the main key if it's not a modifier
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
      // Normalize key names for function keys and special keys
      if (key.startsWith("F") && /^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
        shortcut += key;
      } else if (key.length === 1) {
        shortcut += key.toUpperCase();
      } else {
        shortcut += key;
      }
    }

    if (shortcut.endsWith("+")) {
      shortcut = shortcut.slice(0, -1);
    }

    if (shortcut) {
      setShortcutInput(shortcut);
    }
  }, []);

  const handleInputFocus = useCallback(() => {
    setIsCapturing(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    setIsCapturing(false);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          Keyboard Shortcuts & Startup
        </h2>
        <p className="text-sm text-white/70">
          Configure keyboard shortcuts for quick actions and startup behavior.
        </p>
      </div>

      <Card className="border-white/10">
        <CardContent className="px-4 py-4 space-y-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="record-shortcut" className="text-base font-medium">
                Record Shortcut
              </Label>
              <p className="text-sm text-white/60">
                Global keyboard shortcut to start recording. Press the desired key combination in
                the input field.
              </p>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  id="record-shortcut"
                  value={shortcutInput}
                  onKeyDown={handleKeyCapture}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={isCapturing ? "Press a key combination..." : "F12"}
                  disabled={isLoading || isSaving}
                  className="font-mono"
                  readOnly
                />
                {isCapturing && (
                  <p className="text-xs text-white/50 mt-1">
                    Press any key combination (e.g., F12, Ctrl+Shift+R)
                  </p>
                )}
              </div>
              <Button
                onClick={handleShortcutSave}
                disabled={
                  isLoading ||
                  isSaving ||
                  !shortcutInput.trim() ||
                  shortcutInput === settings.recordShortcut
                }
              >
                Save
              </Button>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1 flex-1">
                <Label htmlFor="auto-launch" className="text-base font-medium">
                  Launch at Startup
                </Label>
                <p className="text-sm text-white/60">
                  Automatically start YakShaver when your computer starts. The app will start
                  minimized in the system tray.
                </p>
              </div>
              <Switch
                id="auto-launch"
                checked={settings.autoLaunchEnabled}
                onCheckedChange={handleAutoLaunchToggle}
                disabled={isLoading || isSaving}
              />
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
            <div className="space-y-2">
              <p className="text-base font-medium">System Tray</p>
              <p className="text-sm text-white/60">
                When you close the YakShaver window, it minimizes to the system tray instead of
                quitting. You can restore the window by clicking the tray icon or right-clicking and
                selecting "Show YakShaver". To fully quit the application, right-click the tray icon
                and select "Quit".
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
