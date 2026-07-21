import { z } from "zod";

export const ToolApprovalModeSchema = z.enum(["yolo", "wait", "ask"]);
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;

const HotkeySchema = z.string().nullable();
export const HotkeysSchema = z.object({
  startRecording: HotkeySchema,
});
export type Hotkeys = z.infer<typeof HotkeysSchema>;
export type HotkeyAction = keyof Hotkeys;

// Bounds for the configurable Executing Task timeout (#698): long enough that a legitimate
// multi-tool-call run isn't cut short, short enough that a stuck loop doesn't hang for 30+
// minutes with no feedback. Exposed as a user setting so it can be tuned per environment.
export const MIN_EXECUTING_TASK_TIMEOUT_MS = 30 * 1000;
export const MAX_EXECUTING_TASK_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_EXECUTING_TASK_TIMEOUT_MS = 5 * 60 * 1000;

export const UserSettingsSchema = z.object({
  toolApprovalMode: ToolApprovalModeSchema,
  openAtLogin: z.boolean(),
  hotkeys: HotkeysSchema,
  /** How long the Executing Task stage can run before it times out and offers a retry (#698). */
  executingTaskTimeoutMs: z
    .number()
    .int()
    .min(MIN_EXECUTING_TASK_TIMEOUT_MS)
    .max(MAX_EXECUTING_TASK_TIMEOUT_MS),
});

export const PartialUserSettingsSchema = UserSettingsSchema.omit({ hotkeys: true })
  .partial()
  .extend({
    hotkeys: HotkeysSchema.partial().optional(),
  });
export type PartialUserSettings = z.infer<typeof PartialUserSettingsSchema>;

export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  toolApprovalMode: "ask",
  openAtLogin: false,
  hotkeys: {
    startRecording: "PrintScreen",
  },
  executingTaskTimeoutMs: DEFAULT_EXECUTING_TASK_TIMEOUT_MS,
};
