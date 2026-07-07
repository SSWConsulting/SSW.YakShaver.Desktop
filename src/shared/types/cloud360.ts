import type { SandboxEvent } from "../../backend/services/yakshaver360/types";

/** A GitHub-backed 360 project the user can file into. */
export interface Cloud360Project {
  id: string;
  name: string;
  githubRepo: string;
}

/** One SandboxEvent broadcast to the renderer, tagged with its shave. */
export interface Cloud360EventPayload {
  shaveId?: string;
  event: SandboxEvent;
  /** True on the first event of a new run so the live view can clear the previous run's feed. */
  runStart?: boolean;
}
