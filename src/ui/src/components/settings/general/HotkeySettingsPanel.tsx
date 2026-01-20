import { DEFAULT_USER_SETTINGS } from "@shared/types/user-settings";
import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { Button } from "../../ui/button";
import { Card, CardContent } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

const FUNCTION_KEY_REGEX = /^F([1-9]|1[0-9]|2[0-4])$/;

interface HotkeySettingsPanelProps {
  isActive: boolean;
}

export function HotkeySettingsPanel({ isActive }: HotkeySettingsPanelProps) {
  const [startRecording, setStartRecording] = useState<string>(
    DEFAULT_USER_SETTINGS.hotkeys.startRecording || "",
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [shortcutInput, setShortcutInput] = useState<string>("");
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await ipcClient.userSettings.get();
      const recordShortcut = current.hotkeys.startRecording || "";
      setStartRecording(recordShortcut);
      setShortcutInput(recordShortcut);
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
      const result = await ipcClient.userSettings.update({
        hotkeys: {
          startRecording: shortcutInput,
        },
      });
      if (result.success) {
        setStartRecording(shortcutInput);
        toast.success(`Record shortcut updated to ${shortcutInput}`);
      } else {
        toast.error("Failed to register shortcut");
      }
    } catch (error) {
      console.error("Failed to update record shortcut", error);
      toast.error("Failed to update record shortcut");
    } finally {
      setIsSaving(false);
    }
  }, [shortcutInput]);

  const handleResetToDefault = useCallback(async () => {
    setIsSaving(true);
    try {
      const defaultShortcut = DEFAULT_USER_SETTINGS.hotkeys.startRecording || "";
      const result = await ipcClient.userSettings.update({
        hotkeys: {
          startRecording: defaultShortcut,
        },
      });
      if (result.success) {
        setStartRecording(defaultShortcut);
        setShortcutInput(defaultShortcut);
        toast.success(`Record shortcut reset to default: ${defaultShortcut}`);
      } else {
        toast.error(
          `Failed to reset shortcut to default: ${defaultShortcut}. Another application may be already using it, please close that application and try again.`,
        );
      }
    } catch (error) {
      console.error("Failed to reset shortcut", error);
      toast.error("Failed to reset shortcut");
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const parts: string[] = [];

    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Command");

    const modifierKeys = ["Control", "Alt", "Shift", "Meta"];
    if (!modifierKeys.includes(e.key)) {
      if (e.key.startsWith("F") && FUNCTION_KEY_REGEX.test(e.key)) {
        parts.push(e.key);
      } else if (e.key.length === 1) {
        parts.push(e.key.toUpperCase());
      } else {
        parts.push(e.key);
      }
    }

    const shortcut = parts.join("+");
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
          Keyboard Shortcuts
        </h2>
        <p className="text-sm text-white/70">Configure keyboard shortcuts for quick actions.</p>
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
            <div className="flex gap-2 items-start">
              <div className="flex-1 space-y-1">
                <Input
                  id="record-shortcut"
                  value={shortcutInput}
                  onKeyDown={handleKeyCapture}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={
                    isCapturing
                      ? "Press a key combination..."
                      : DEFAULT_USER_SETTINGS.hotkeys.startRecording || ""
                  }
                  disabled={isLoading || isSaving}
                  className="font-mono"
                  readOnly
                />
                <div className="h-5">
                  {isCapturing && (
                    <p className="text-xs text-white/50">
                      Press a key combination (e.g., Ctrl+F12, Ctrl+Shift+R)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleShortcutSave}
                  disabled={
                    isLoading ||
                    isSaving ||
                    !shortcutInput.trim() ||
                    shortcutInput === startRecording
                  }
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={handleResetToDefault}
                  disabled={
                    isLoading ||
                    isSaving ||
                    startRecording === DEFAULT_USER_SETTINGS.hotkeys.startRecording
                  }
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
