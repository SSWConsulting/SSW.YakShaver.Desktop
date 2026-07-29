import { type BadgeVariant, type Shave, ShaveStatus } from "../types";

const STATUS_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  [ShaveStatus.Completed]: "success",
  [ShaveStatus.Cancelled]: "secondary",
  [ShaveStatus.Processing]: "secondary",
  [ShaveStatus.Failed]: "destructive",
};

export function getStatusVariant(status: string): BadgeVariant {
  return STATUS_BADGE_VARIANTS[status] ?? "default";
}

export function getShaveWorkflowPath(shave: Pick<Shave, "id" | "shaveStatus">): string {
  return `/workflow/${shave.id}`;
}
