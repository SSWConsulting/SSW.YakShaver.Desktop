import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ipcClient } from "../services/ipc-client";
import type { AdvancedSettings } from "../types";
import { formatErrorMessage } from "../utils";

interface AdvancedSettingsContextValue {
  settings: AdvancedSettings;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<AdvancedSettings>;
  updateSettings: (updates: Partial<AdvancedSettings>) => Promise<AdvancedSettings>;
}

const DEFAULT_SETTINGS: AdvancedSettings = {
  enableYoutubeUrlImport: false,
};

const AdvancedSettingsContext = createContext<AdvancedSettingsContextValue | undefined>(undefined);

export function AdvancedSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await ipcClient.advancedSettings.get();
      setSettings(result);
      setError(null);
      return result;
    } catch (err) {
      const message = formatErrorMessage(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<AdvancedSettings>) => {
    try {
      const result = await ipcClient.advancedSettings.update(updates);
      setSettings(result);
      setError(null);
      return result;
    } catch (err) {
      const message = formatErrorMessage(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const value: AdvancedSettingsContextValue = {
    settings,
    isLoading,
    error,
    refresh,
    updateSettings,
  };

  return <AdvancedSettingsContext.Provider value={value}>{children}</AdvancedSettingsContext.Provider>;
}

export function useAdvancedSettings() {
  const context = useContext(AdvancedSettingsContext);
  if (!context) {
    throw new Error("useAdvancedSettings must be used within an AdvancedSettingsProvider");
  }
  return context;
}

