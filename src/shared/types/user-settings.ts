export type ToolApprovalMode = "yolo" | "wait" | "ask";

export interface UserSettings {
  toolApprovalMode: ToolApprovalMode;
  openAtLogin: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  toolApprovalMode: "ask",
  openAtLogin: false,
};
