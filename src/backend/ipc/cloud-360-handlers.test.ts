import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { getAccessToken, fetchGitHubProjects } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetchGitHubProjects: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
}));

vi.mock("../services/auth/identity-server-auth", () => ({
  IdentityServerAuthService: { getInstance: () => ({ getAccessToken }) },
}));

vi.mock("../services/yakshaver360/github-projects", () => ({ fetchGitHubProjects }));

import { IPC_CHANNELS } from "./channels";
import { Cloud360IPCHandlers } from "./cloud-360-handlers";

beforeEach(() => {
  handlers.clear();
  getAccessToken.mockReset();
  fetchGitHubProjects.mockReset();
  new Cloud360IPCHandlers();
});

describe("Cloud360IPCHandlers list-projects", () => {
  it("returns GitHub projects for a signed-in user", async () => {
    getAccessToken.mockResolvedValue("tok");
    fetchGitHubProjects.mockResolvedValue([{ id: "1", name: "GH", githubRepo: "a/b" }]);

    const handler = handlers.get(IPC_CHANNELS.CLOUD360_LIST_PROJECTS);
    if (!handler) throw new Error("handler not registered");
    const result = await handler({});

    expect(fetchGitHubProjects).toHaveBeenCalledWith("tok");
    expect(result).toEqual([{ id: "1", name: "GH", githubRepo: "a/b" }]);
  });

  it("throws when not signed in", async () => {
    getAccessToken.mockResolvedValue(null);
    const handler = handlers.get(IPC_CHANNELS.CLOUD360_LIST_PROJECTS);
    if (!handler) throw new Error("handler not registered");
    await expect(handler({})).rejects.toThrow("Not signed in");
  });
});
