export interface KeyboardShortcutSettings {
  recordShortcut: string;
  autoLaunchEnabled: boolean;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutSettings = {
  recordShortcut: "F12",
  autoLaunchEnabled: false,
};
