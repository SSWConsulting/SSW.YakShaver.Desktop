import { z } from "zod";

export const ToolApprovalModeSchema = z.enum(["yolo", "wait", "ask"]);
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>;

export const UserSettingsSchema = z.object({
  toolApprovalMode: ToolApprovalModeSchema,
  openAtLogin: z.boolean(),
});

export const PartialUserSettingsSchema = UserSettingsSchema.partial();

export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  toolApprovalMode: "ask",
  openAtLogin: false,
};
