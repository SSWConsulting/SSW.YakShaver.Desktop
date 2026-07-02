// Must stay structurally identical to SSW.YakShaver's src/lib/yakshave-now/sandbox/types.ts so the
// SSE frames 360 emits deserialize 1:1 here — do not change these shapes without changing 360 too.

/** One SSE frame emitted by the 360 process/execute streams. */
export type SandboxEvent =
  | { type: "status"; message: string }
  | { type: "log"; stream: "stdout" | "stderr"; data: string }
  | { type: "result"; summary: string; artifacts: string[] }
  | { type: "error"; message: string }
  | { type: "approval-required"; plan: string }
  | { type: "named"; name: string };

export interface YakShaver360Project {
  id: string;
  name: string;
  githubRepo: string | null;
  skill: string;
  autoExecute: boolean;
}

export interface YakShaver360Recording {
  id: string;
  projectId: string;
  filePath: string;
  notes: string;
  status: string;
  resultSummary?: string | null;
}

export interface ProcessRecordingOptions {
  videoAnalysis?: boolean;
  autoExecute?: boolean;
}

/** Response of POST /api/360/recordings/upload: a signed Azure target plus the ticket to claim it. */
export interface RecordingUploadTarget {
  blobName: string;
  uploadUrl: string;
  expiresAt: string;
  uploadTicket: string;
}
