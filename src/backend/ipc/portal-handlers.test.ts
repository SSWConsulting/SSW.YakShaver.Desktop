import { ipcMain } from "electron";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import { fetchProjectSummaries, mapProjectsResponse } from "../services/portal/portal-projects";
import { IPC_CHANNELS } from "./channels";
import { registerPortalHandlers } from "./portal-handlers";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock("../services/portal/portal-projects", () => ({
  fetchProjectSummaries: vi.fn(),
  mapProjectsResponse: vi.fn(),
}));

type Handler = (...args: unknown[]) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const call = (ipcMain.handle as Mock).mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1] as Handler;
}

describe("registerPortalHandlers — PORTAL_GET_MY_PROJECTS (#816)", () => {
  let getAccessToken: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken = vi.fn();
    const authService = { getAccessToken } as unknown as IdentityServerAuthService;
    registerPortalHandlers(authService);
  });

  it("returns the NOT_SIGNED_IN discriminator when there is no access token", async () => {
    getAccessToken.mockResolvedValue(null);

    const result = await getHandler(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS)();

    expect(result).toEqual({ success: false, code: "NOT_SIGNED_IN", error: "Not signed in" });
    // Must short-circuit before hitting the network.
    expect(fetchProjectSummaries).not.toHaveBeenCalled();
  });

  it("returns the mapped items on the connected happy path (AC2)", async () => {
    getAccessToken.mockResolvedValue("token");
    (fetchProjectSummaries as Mock).mockResolvedValue([{ id: "p1", title: "Acme" }]);
    (mapProjectsResponse as Mock).mockReturnValue([{ id: "p1", name: "Acme", description: null }]);

    const result = await getHandler(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS)();

    expect(fetchProjectSummaries).toHaveBeenCalledWith("token");
    expect(result).toEqual({
      success: true,
      data: { items: [{ id: "p1", name: "Acme", description: null }] },
    });
  });

  it("maps a genuinely empty membership list to a success with [] (AC3 empty state)", async () => {
    getAccessToken.mockResolvedValue("token");
    (fetchProjectSummaries as Mock).mockResolvedValue([]);
    (mapProjectsResponse as Mock).mockReturnValue([]);

    const result = await getHandler(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS)();

    expect(result).toEqual({ success: true, data: { items: [] } });
  });

  it("surfaces REQUEST_FAILED (not a false-empty) when the body is an unrecognised shape", async () => {
    getAccessToken.mockResolvedValue("token");
    (fetchProjectSummaries as Mock).mockResolvedValue({ unexpected: true });
    (mapProjectsResponse as Mock).mockReturnValue(null);

    const result = (await getHandler(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS)()) as {
      success: boolean;
      code: string;
    };

    expect(result.success).toBe(false);
    expect(result.code).toBe("REQUEST_FAILED");
  });

  it("surfaces REQUEST_FAILED when the fetch rejects (network/non-2xx)", async () => {
    getAccessToken.mockResolvedValue("token");
    (fetchProjectSummaries as Mock).mockRejectedValue(new Error("API call failed: 500"));

    const result = (await getHandler(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS)()) as {
      success: boolean;
      code: string;
    };

    expect(result.success).toBe(false);
    expect(result.code).toBe("REQUEST_FAILED");
  });
});
