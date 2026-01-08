export type ToolApprovalMode = "yolo" | "wait" | "ask";

export interface ToolApprovalSettings {
  toolApprovalMode: ToolApprovalMode;
}
