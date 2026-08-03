import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  config: { portalApiUrl: () => "https://api.test/api" },
}));

import { checkCloud360Credits } from "./credit-precheck";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkCloud360Credits", () => {
  it("allows a shave when credits remain", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ remaining: 3 }));
    await expect(checkCloud360Credits("t")).resolves.toEqual({ canShave: true });
  });

  it("blocks and names the reason when the plan is spent", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ remaining: 0, error: "InsufficientCredits" }),
    );
    const result = await checkCloud360Credits("t");
    expect(result.canShave).toBe(false);
    expect(result.reason).toBe("out-of-credits");
  });

  it.each([
    "NoStripeCustomer",
    "NoActiveSubscription",
  ])("reports %s as having no plan rather than a spent one", async (error) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ remaining: 0, error }));
    const result = await checkCloud360Credits("t");
    expect(result.reason).toBe("no-subscription");
  });

  // Fail-open contract: this check is a courtesy, so anything it cannot confidently read must let
  // the shave through and leave the verdict to the authoritative gate on the process route.
  describe("fails open", () => {
    it("when the request throws (offline, DNS, timeout)", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("network down"));
      await expect(checkCloud360Credits("t")).resolves.toEqual({ canShave: true });
    });

    it("when the endpoint returns a non-ok status", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false));
      await expect(checkCloud360Credits("t")).resolves.toEqual({ canShave: true });
    });

    it("when the body is not JSON", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response);
      await expect(checkCloud360Credits("t")).resolves.toEqual({ canShave: true });
    });

    // A malformed 200 must not read as "no credits" — `?? 0` alone would have blocked a paying user.
    it.each([
      [null],
      [undefined],
      ["5"],
      [Number.NaN],
    ])("when remaining is %p rather than a number", async (remaining) => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ remaining }));
      await expect(checkCloud360Credits("t")).resolves.toEqual({ canShave: true });
    });
  });

  it("gives the request a timeout so a hung backend cannot stall the dialog", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ remaining: 1 }));
    await checkCloud360Credits("t");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
