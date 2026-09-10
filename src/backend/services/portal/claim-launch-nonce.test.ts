import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  config: { portalApiUrl: () => "https://api.example.test/api" },
}));

vi.mock("../auth/identity-server-auth", () => ({
  IdentityServerAuthService: { getInstance: vi.fn() },
}));

import { IdentityServerAuthService } from "../auth/identity-server-auth";
import { claimLaunchNonce, isNonceShaped } from "./claim-launch-nonce";

// Claiming the nonce is the whole basis for the portal saying "the app opened" instead of guessing
// from window focus, so these pin the two directions that matter: a claim that lands, and a claim
// that must not be retried into a false positive.

const NONCE = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const CLAIM_URL = `https://api.example.test/api/desktopapp/launch-handshake/${NONCE}/claim`;

const respondWith = (status: number) =>
  ({ ok: status >= 200 && status < 300, status }) as unknown as Response;

const withToken = (token: string | null) => {
  vi.mocked(IdentityServerAuthService.getInstance).mockReturnValue({
    getAccessToken: vi.fn().mockResolvedValue(token),
  } as unknown as ReturnType<typeof IdentityServerAuthService.getInstance>);
};

// Never the real one: a retry test would otherwise wait five seconds for no benefit.
const noWait = vi.fn().mockResolvedValue(undefined);

describe("claimLaunchNonce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withToken("tok");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts the nonce with a bearer token and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CLAIM_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  // 404 covers two situations and both are terminal: the nonce really is unknown or spent, or this
  // app has shipped ahead of the backend and the route does not exist yet. An unmapped ASP.NET route
  // answers 404, so a version-skew window must not turn into a retry storm on every launch.
  it("treats 404 as final, whether the nonce is spent or the API has no handshake yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(noWait).not.toHaveBeenCalled();
  });

  it("retries a server error and succeeds on a later attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respondWith(503))
      .mockResolvedValueOnce(respondWith(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(noWait).toHaveBeenCalledWith(500);
  });

  it("retries a network failure, which is the case the app launching before the network is up", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValueOnce(respondWith(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the backoff is exhausted rather than retrying forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respondWith(500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(false);

    // One initial attempt plus one per backoff delay.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(noWait.mock.calls.map(([ms]) => ms)).toEqual([500, 1500, 3000]);
  });

  // The first launch after installing from the Tools page: the app has opened but nobody has signed
  // in yet. Refusing to claim here would report "not installed" for an app that is on screen, which
  // is the exact failure this whole handshake exists to prevent.
  it("claims without a token when the user has not signed in yet", async () => {
    withToken(null);
    const fetchMock = vi.fn().mockResolvedValue(respondWith(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("claims anyway when reading the token throws, rather than losing the launch", async () => {
    vi.mocked(IdentityServerAuthService.getInstance).mockReturnValue({
      getAccessToken: vi.fn().mockRejectedValue(new Error("refresh failed, network is down")),
    } as unknown as ReturnType<typeof IdentityServerAuthService.getInstance>);
    const fetchMock = vi.fn().mockResolvedValue(respondWith(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimLaunchNonce(NONCE, { sleep: noWait })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("isNonceShaped", () => {
  it.each([NONCE, NONCE.toUpperCase()])("accepts %s", (nonce) => {
    expect(isNonceShaped(nonce)).toBe(true);
  });

  it.each(["", "not-a-uuid", "../../etc/passwd", `${NONCE}x`])("rejects %s", (nonce) => {
    expect(isNonceShaped(nonce)).toBe(false);
  });
});
