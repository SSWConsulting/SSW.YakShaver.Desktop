import type { Cloud360Project } from "../../../shared/types/cloud360";
import { config } from "../../config/env";

interface PortalProjectDto {
  id: string;
  name: string;
  backlogUrl?: string | null;
}

function githubRepoFromBacklogUrl(backlogUrl?: string | null): string | null {
  if (!backlogUrl) return null;
  try {
    const url = new URL(backlogUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

/** List the signed-in user's GitHub-backed projects (360 requires a GitHub project). */
export async function fetchGitHubProjects(token: string): Promise<Cloud360Project[]> {
  const url = `${config.portalApiUrl()}/projects`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to load projects (${response.status})`);
  }
  const projects = (await response.json()) as PortalProjectDto[];
  return projects
    .map((p) => ({ id: p.id, name: p.name, githubRepo: githubRepoFromBacklogUrl(p.backlogUrl) }))
    .filter((p): p is Cloud360Project => p.githubRepo !== null);
}
