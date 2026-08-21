import { describe, expect, it } from "vitest";
import {
  clampRateLimitBlockedUntil,
  extractPRNumber,
  type GitHubRelease,
  processReleases,
  toCachedReleases,
} from "./releases";

const RELEASE_WITH_PR_IN_NAME = {
  tag_name: "beta.42.1",
  name: "PR #42 build",
  prerelease: true,
  published_at: "2026-01-01T00:00:00Z",
} satisfies GitHubRelease;

describe("release processing", () => {
  it("extracts a PR number from the release name or body", () => {
    expect(extractPRNumber(RELEASE_WITH_PR_IN_NAME)).toBe("42");
    expect(
      extractPRNumber({
        ...RELEASE_WITH_PR_IN_NAME,
        name: null,
        body: "Automated build for PR #99",
      }),
    ).toBe("99");
    expect(extractPRNumber({ ...RELEASE_WITH_PR_IN_NAME, name: "Stable release" })).toBeNull();
  });

  it("keeps only prereleases that identify a PR", () => {
    expect(
      toCachedReleases([
        RELEASE_WITH_PR_IN_NAME,
        { ...RELEASE_WITH_PR_IN_NAME, tag_name: "stable", prerelease: false },
        { ...RELEASE_WITH_PR_IN_NAME, tag_name: "unknown", name: null },
      ]),
    ).toEqual([
      {
        prNumber: "42",
        tag: "beta.42.1",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("keeps the latest release per PR and sorts PRs descending", () => {
    expect(
      processReleases([
        { prNumber: "7", tag: "beta.7.1", publishedAt: "2026-01-01T00:00:00Z" },
        { prNumber: "42", tag: "beta.42.1", publishedAt: "2026-01-02T00:00:00Z" },
        { prNumber: "7", tag: "beta.7.2", publishedAt: "2026-01-03T00:00:00Z" },
      ]),
    ).toEqual([
      {
        prNumber: "42",
        tag: "beta.42.1",
        version: "beta.42.1",
        publishedAt: "2026-01-02T00:00:00Z",
      },
      {
        prNumber: "7",
        tag: "beta.7.2",
        version: "beta.7.2",
        publishedAt: "2026-01-03T00:00:00Z",
      },
    ]);
  });
});

describe("rate-limit backoff", () => {
  const now = 1_800_000_000_000;

  it("uses the requested retry time when it is within the one-hour limit", () => {
    expect(clampRateLimitBlockedUntil(now + 2 * 60 * 1000, now)).toBe(now + 2 * 60 * 1000);
  });

  it("falls back to one minute for invalid or expired retry times", () => {
    expect(clampRateLimitBlockedUntil(Number.NaN, now)).toBe(now + 60 * 1000);
    expect(clampRateLimitBlockedUntil(now - 1, now)).toBe(now + 60 * 1000);
  });

  it("caps excessive retry times at one hour", () => {
    expect(clampRateLimitBlockedUntil(now + 2 * 60 * 60 * 1000, now)).toBe(now + 60 * 60 * 1000);
  });
});
