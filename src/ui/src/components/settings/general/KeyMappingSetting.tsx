import { DEFAULT_USER_SETTINGS } from "@shared/types/user-settings";
import { Keyboard } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

const FUNCTION_KEY_REGEX = /^F([1-9]|1[0-9]|2[0-4])$/;

interface KeyMappingSettingProps {
  isActive: boolean;
}

export function KeyMappingSetting({ isActive }: KeyMappingSettingProps) {
  const inputId = useId();
  const [startRecording, setStartRecording] = useState<string>(
    DEFAULT_USER_SETTINGS.hotkeys.startRecording ?? "",
  );
  const [shortcutInput, setShortcutInput] = useState<string>("");
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const defaultShortcut = DEFAULT_USER_SETTINGS.hotkeys.startRecording ?? "";

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const current = await ipcClient.userSettings.get();
        const recordShortcut = current.hotkeys.startRecording ?? "";
        if (!cancelled) {
          setStartRecording(recordShortcut);
          setShortcutInput(recordShortcut);
        }
      } catch (error) {
        console.error("Failed to load keyboard shortcut settings", error);
        toast.error(`Failed to load keyboard shortcut settings: ${formatErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

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
      if (!result.success) {
        throw new Error(result.error ?? "Failed to register shortcut");
      }

      setStartRecording(shortcutInput);
      toast.success(`Record shortcut updated to ${shortcutInput}`);
    } catch (error) {
      console.error("Failed to update record shortcut", error);
      toast.error(`Failed to update record shortcut: ${formatErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, [shortcutInput]);

  const handleResetToDefault = useCallback(async () => {
    setIsSaving(true);
    try {
      const result = await ipcClient.userSettings.update({
        hotkeys: {
          startRecording: defaultShortcut,
        },
      });
      if (!result.success) {
        throw new Error(
          result.error ??
            `Failed to reset shortcut to default: ${defaultShortcut}. Another application may be using it.`,
        );
      }

      setStartRecording(defaultShortcut);
      setShortcutInput(defaultShortcut);
      toast.success(`Record shortcut reset to default: ${defaultShortcut}`);
    } catch (error) {
      console.error("Failed to reset shortcut", error);
      toast.error(`Failed to reset shortcut: ${formatErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, [defaultShortcut]);

  const handleKeyCapture = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const parts: string[] = [];

    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Command");

    const modifierKeys = ["Control", "Alt", "Shift", "Meta"];
    if (!modifierKeys.includes(event.key)) {
      if (event.key.startsWith("F") && FUNCTION_KEY_REGEX.test(event.key)) {
        parts.push(event.key);
      } else if (event.key.length === 1) {
        parts.push(event.key.toUpperCase());
      } else {
        parts.push(event.key);
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

  const isDisabled = isLoading || isSaving;

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-4 w-4" />
          Key Mapping
        </CardTitle>
        <CardDescription>
          Set the global shortcut used to start a YakShaver recording.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-4">
        <div className="grid gap-3 md:grid-cols-[130px_minmax(0,1fr)_auto] md:items-start">
          <Label htmlFor={inputId} className="pt-2 text-sm font-medium">
            Record shortcut
          </Label>
          <div className="min-w-0 space-y-1">
            <Input
              id={inputId}
              value={shortcutInput}
              onKeyDown={handleKeyCapture}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder={isCapturing ? "Press a key combination..." : defaultShortcut}
              disabled={isDisabled}
              className="font-mono"
              readOnly
            />
            <div className="h-5">
              {isCapturing && (
                <p className="text-xs text-muted-foreground">
                  Press a key combination, for example Ctrl+F12 or Ctrl+Shift+R.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => void handleShortcutSave()}
              disabled={isDisabled || !shortcutInput.trim() || shortcutInput === startRecording}
            >
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleResetToDefault()}
              disabled={isDisabled || startRecording === defaultShortcut}
            >
              Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
