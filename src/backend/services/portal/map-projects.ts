import type { Project } from "../../types";

/**
 * The shape returned by the portal `GET {portalApiUrl}/projects/summaries` endpoint —
 * the projects the signed-in user is a member of (#816). This is the same endpoint the
 * remote-prompts feature already consumes in production (see PromptManager.getRemotePrompts),
 * so the contract is confirmed: a JSON array of `{ id, title, description }`.
 */
interface ProjectSummaryDto {
  id: string;
  title: string;
  description?: string;
}

function isProjectSummaryDto(value: unknown): value is ProjectSummaryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}

/**
 * Maps the portal `/projects/summaries` response into the {@link Project} shape (#816).
 *
 * Returns `null` when the response is NOT a recognised project-summary list (wrong shape,
 * non-array body, entries missing the expected `id`/`title` fields). The handler uses this
 * to surface a real error instead of a misleading "you're not a member of any projects"
 * empty state. A genuine empty membership list maps to `[]`.
 */
export function mapProjectsResponse(parsed: unknown): Project[] | null {
  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return [];
  // An array of objects that don't carry the expected fields is an unrecognised shape,
  // not an empty membership — signal that to the caller rather than silently dropping rows.
  if (!parsed.every(isProjectSummaryDto)) return null;
  return parsed.map((dto) => ({
    id: dto.id,
    name: dto.title,
    description: dto.description ?? null,
  }));
}
