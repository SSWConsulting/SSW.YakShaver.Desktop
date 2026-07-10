import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyGitHubToken } from "./github-token-verifier";

function headerResponse(
  status: number,
  headers: Record<string, string>,
  body: unknown = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Error",
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

describe("verifyGitHubToken (#919 — shared token health check)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports invalid with no network call when there is no token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyGitHubToken(undefined);

    expect(result).toEqual({ isValid: false, error: "No token configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports valid with username/scopes/rate-limit on a healthy token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          headerResponse(
            200,
            { "x-oauth-scopes": "repo, read:user", "x-ratelimit-remaining": "4999" },
            { login: "octocat" },
          ),
        ),
    );

    const result = await verifyGitHubToken("ghp_valid");

    expect(result).toEqual({
      isValid: true,
      username: "octocat",
      scopes: ["repo", "read:user"],
      rateLimitRemaining: 4999,
    });
  });

  it("classifies a 401 as an invalid/expired token — the exact bug in #919", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(headerResponse(401, {})));

    const result = await verifyGitHubToken("bad-random-string");

    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Invalid or expired token");
  });

  it("classifies a rate-limited 403 distinctly from an invalid token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(headerResponse(403, { "x-ratelimit-remaining": "0" })),
    );

    const result = await verifyGitHubToken("ghp_ratelimited");

    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Rate limit exceeded");
  });

  it("returns isValid: false when the fetch itself throws (offline/network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));

    const result = await verifyGitHubToken("ghp_valid");

    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
