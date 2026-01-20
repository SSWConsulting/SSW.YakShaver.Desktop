import { z } from "zod";

export const ToolApprovalModeSchema = z.enum(["yolo", "wait", "ask"]);
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;

const HotkeySchema = z.string().nullable();
export const HotkeysSchema = z.object({
  startRecording: HotkeySchema,
});
export type Hotkeys = z.infer<typeof HotkeysSchema>;
export type HotkeyAction = keyof Hotkeys;

export const UserSettingsSchema = z.object({
  toolApprovalMode: ToolApprovalModeSchema,
  openAtLogin: z.boolean(),
  hotkeys: HotkeysSchema,
});

export const PartialUserSettingsSchema = UserSettingsSchema.partial();
export type PartialUserSettings = z.infer<typeof PartialUserSettingsSchema>;

export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  toolApprovalMode: "ask",
  openAtLogin: false,
  hotkeys: {
    startRecording: "PrintScreen",
  },
};
