import type { Project } from "../../types";

/**
 * Maps an unverified portal/tenants response into the {@link Project} shape (#816).
 *
 * The "list my projects" backend contract isn't confirmed yet, so this tolerates either a
 * bare array or an `{ items }` envelope, and accepts the common id/name/role field-name
 * variants. Once the real endpoint/shape is pinned this becomes a one-line change.
 */
export function mapProjectsResponse(parsed: unknown): Project[] {
  // biome-ignore lint/suspicious/noExplicitAny: unverified backend shape
  const envelope = parsed as any;
  // biome-ignore lint/suspicious/noExplicitAny: unverified backend shape
  const raw: any[] = Array.isArray(parsed) ? parsed : (envelope?.items ?? []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t != null)
    .map((t) => ({
      id: String(t.id ?? t.tenantId ?? t.projectId ?? ""),
      name: String(t.name ?? t.displayName ?? t.tenantName ?? t.id ?? "Untitled"),
      role: t.role ?? t.membershipRole ?? null,
    }));
}
