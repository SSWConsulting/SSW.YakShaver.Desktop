import type { ProcessedRelease } from "@shared/types/release-channel";
import type { CachedRelease } from "../services/storage/release-channel-storage";

export interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  prerelease: boolean;
  published_at: string;
}

const DEFAULT_RATE_LIMIT_BACKOFF = 60 * 1000;
const MAX_RATE_LIMIT_BACKOFF = 60 * 60 * 1000;

/**
 * Group cached releases by PR, keep the latest release for each PR, and sort by PR number.
 */
export function processReleases(releases: readonly CachedRelease[]): ProcessedRelease[] {
  const sorted = [...releases].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  const releasesByPR = new Map<string, CachedRelease>();
  for (const release of sorted) {
    if (!releasesByPR.has(release.prNumber)) {
      releasesByPR.set(release.prNumber, release);
    }
  }

  return Array.from(releasesByPR.entries())
    .sort(
      ([prNumberA], [prNumberB]) => Number.parseInt(prNumberB, 10) - Number.parseInt(prNumberA, 10),
    )
    .map(([prNumber, release]) => ({
      prNumber,
      tag: release.tag,
      version: release.tag,
      publishedAt: release.publishedAt,
    }));
}

export function toCachedReleases(releases: readonly GitHubRelease[]): CachedRelease[] {
  const cachedReleases: CachedRelease[] = [];
  for (const release of releases) {
    if (!release.prerelease) {
      continue;
    }

    const prNumber = extractPRNumber(release);
    if (!prNumber) {
      continue;
    }

    cachedReleases.push({
      prNumber,
      tag: release.tag_name,
      publishedAt: release.published_at,
    });
  }
  return cachedReleases;
}

export function extractPRNumber(release: GitHubRelease): string | null {
  const prMatch = release.name?.match(/PR #(\d+)/) || release.body?.match(/PR #(\d+)/);
  return prMatch ? prMatch[1] : null;
}

export function clampRateLimitBlockedUntil(candidate: number, now: number): number {
  if (!Number.isFinite(candidate) || candidate <= now) {
    return now + DEFAULT_RATE_LIMIT_BACKOFF;
  }

  return Math.min(candidate, now + MAX_RATE_LIMIT_BACKOFF);
}
