import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  config: { portalApiUrl: () => "https://api-staging.yakshaver.ai/api" },
}));

import { fetchGitHubProjects } from "./github-projects";

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

afterEach(() => vi.restoreAllMocks());

describe("fetchGitHubProjects", () => {
  it("keeps only github.com projects and maps owner/repo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson([
        { id: "1", name: "GH", backlogUrl: "https://github.com/acme/widgets" },
        { id: "2", name: "ADO", backlogUrl: "https://dev.azure.com/acme/x" },
        { id: "3", name: "NoUrl", backlogUrl: null },
      ]),
    );

    const result = await fetchGitHubProjects("tok");

    expect(result).toEqual([{ id: "1", name: "GH", githubRepo: "acme/widgets" }]);
  });

  it("rejects look-alike hosts but accepts www.github.com", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson([
        { id: "1", name: "Fake", backlogUrl: "https://notgithub.com/acme/widgets" },
        { id: "2", name: "Sub", backlogUrl: "https://github.com.evil.com/acme/widgets" },
        { id: "3", name: "Www", backlogUrl: "https://www.github.com/acme/widgets" },
      ]),
    );

    const result = await fetchGitHubProjects("tok");

    expect(result).toEqual([{ id: "3", name: "Www", githubRepo: "acme/widgets" }]);
  });

  it("sends the bearer token to /api/projects", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));

    await fetchGitHubProjects("tok");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api-staging.yakshaver.ai/api/projects");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("returns [] for an empty project list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));
    expect(await fetchGitHubProjects("tok")).toEqual([]);
  });

  it("throws on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchGitHubProjects("tok")).rejects.toThrow("401");
  });
});
