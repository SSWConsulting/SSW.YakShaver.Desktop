import { createContext, type ReactNode, useContext, useState } from "react";

interface AdvancedSettings {
  isYoutubeUrlWorkflowEnabled: boolean;
}

interface AdvancedSettingsContextValue extends AdvancedSettings {
  setYoutubeUrlWorkflowEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = "advancedSettings";
const defaultSettings: AdvancedSettings = {
  isYoutubeUrlWorkflowEnabled: false,
};

const AdvancedSettingsContext = createContext<AdvancedSettingsContextValue | undefined>(undefined);

const loadSettings = (): AdvancedSettings => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

const persistSettings = (settings: AdvancedSettings) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures
  }
};

export function AdvancedSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AdvancedSettings>(loadSettings);

  const setYoutubeUrlWorkflowEnabled = (enabled: boolean) => {
    const updated = { ...settings, isYoutubeUrlWorkflowEnabled: enabled };
    setSettings(updated);
    persistSettings(updated);
  };

  return (
    <AdvancedSettingsContext.Provider value={{ ...settings, setYoutubeUrlWorkflowEnabled }}>
      {children}
    </AdvancedSettingsContext.Provider>
  );
}

export function useAdvancedSettings() {
  const context = useContext(AdvancedSettingsContext);
  if (!context) {
    throw new Error("useAdvancedSettings must be used within an AdvancedSettingsProvider");
  }
  return context;
}
