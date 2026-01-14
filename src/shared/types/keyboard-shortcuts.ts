export interface KeyboardShortcutSettings {
  recordShortcut: string;
  autoLaunchEnabled: boolean;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutSettings = {
  recordShortcut: "PrintScreen",
  autoLaunchEnabled: false,
};
