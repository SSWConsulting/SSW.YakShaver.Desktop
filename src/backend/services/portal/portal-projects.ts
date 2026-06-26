import https from "node:https";
import type { Project } from "@shared/types/portal";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";

/**
 * Path (relative to the portal API base) of the project-summaries endpoint.
 *
 * IMPORTANT (#816 AC2): this endpoint is the backend `GetProjectSummaries` query, which is
 * scoped to the signed-in user's *tenant/organisation* — it returns every active project in
 * the caller's org, NOT only the projects the caller is an explicit member of. There is no
 * user-membership-scoped endpoint in the backend yet; that contract is tracked in backend
 * issue SSWConsulting/SSW.YakShaver#3775. When #3775 lands, repoint this one constant at the
 * user-scoped path (e.g. `/me/projects`) and the Projects section becomes a true memberships
 * list — no other change required here.
 */
export const PROJECT_SUMMARIES_PATH = "/projects/summaries";

/**
 * The shape returned by the portal `GET {portalApiUrl}${PROJECT_SUMMARIES_PATH}` endpoint.
 * A JSON array of `{ id, title, description }`. This module is the single owner of that
 * contract — both the remote-prompts feature (PromptManager.getRemotePrompts) and the
 * Projects section (#816) consume it from here rather than re-deriving it (AGENTS.md
 * Rule 7 / Rule 10), so the endpoint contract can't drift between the two call sites.
 */
export interface ProjectSummaryDto {
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
 * Performs the authenticated `GET {portalApiUrl}${PROJECT_SUMMARIES_PATH}` request and returns
 * the raw parsed JSON body. Uses the Node `https` module (rather than `fetch`) to stay
 * consistent with the other portal calls' SSL-certificate handling. Rejects on a non-2xx status
 * or a body that fails to parse as JSON. Callers are responsible for validating/mapping the shape.
 */
export function fetchProjectSummaries(accessToken: string): Promise<unknown> {
  const url = new URL(config.portalApiUrl());
  const hostname = url.hostname;
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  const path = `${url.pathname.replace(/\/$/, "")}${PROJECT_SUMMARIES_PATH}`;

  return new Promise<unknown>((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port,
        path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(responseData));
            } catch (error) {
              reject(new Error(`Failed to parse JSON response: ${formatErrorMessage(error)}`));
            }
          } else {
            reject(new Error(`API call failed: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
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
