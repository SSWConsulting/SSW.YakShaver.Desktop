/**
 * Portal-projects types shared between the backend IPC handler and the UI (#816).
 *
 * These are consumed by both layers (`src/backend/ipc/portal-handlers.ts` +
 * `src/backend/services/portal/*` and `src/ui/src/services/ipc-client.ts` +
 * `src/ui/src/pages/ProjectsPage.tsx`), so per AGENTS.md Rule 9 they live in
 * `src/shared/types/` rather than being duplicated across the two layers.
 */

/**
 * A project surfaced in the desktop Projects section (#816). Sourced from the portal
 * `GET {portalApiUrl}/projects/summaries` endpoint (`{ id, title, description }`).
 *
 * That endpoint is tenant/organisation-scoped (all active projects in the signed-in user's
 * org), not membership-scoped — a true "projects I'm a member of" list awaits the user-scoped
 * backend endpoint tracked in SSWConsulting/SSW.YakShaver#3775.
 */
export interface Project {
  id: string;
  name: string;
  description?: string | null;
}

export interface GetMyProjectsResponse {
  items: Project[];
}

/** Discriminated error codes the get-my-projects handler can return (#816). */
export type GetMyProjectsErrorCode = "NOT_SIGNED_IN" | "REQUEST_FAILED";
