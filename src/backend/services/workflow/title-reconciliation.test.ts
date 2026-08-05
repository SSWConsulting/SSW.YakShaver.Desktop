import { describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: { getInstance: () => ({ trackEvent: vi.fn() }) },
}));

import type { BacklogItemResolver } from "../backlog/backlog-item-resolver";
import { reconcileWorkItemTitleAsync } from "./title-reconciliation";

const finalOutput = (url?: string) =>
  JSON.stringify({
    Status: "Success",
    Title: "Title the model reported",
    ...(url ? { URL: url } : {}),
  });

const resolverReturning = (
  resolution: Awaited<ReturnType<BacklogItemResolver["resolveAsync"]>>,
): BacklogItemResolver => ({ resolveAsync: vi.fn().mockResolvedValue(resolution) });

describe("reconcileWorkItemTitleAsync", () => {
  it("adopts the work item's title over the one the model reported", async () => {
    const resolver = resolverReturning({
      ok: true,
      platform: "github",
      title: "🐛 The title that is actually on the issue",
    });

    const result = await reconcileWorkItemTitleAsync(
      resolver,
      finalOutput("https://github.com/o/r/issues/42"),
    );

    expect(result.title).toBe("🐛 The title that is actually on the issue");
    expect(result.retryable).toBe(false);
  });

  it("passes the project's selected servers through to the read", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "t" });

    await reconcileWorkItemTitleAsync(resolver, finalOutput("https://github.com/o/r/issues/42"), [
      "github",
    ]);

    expect(resolver.resolveAsync).toHaveBeenCalledWith("https://github.com/o/r/issues/42", [
      "github",
    ]);
  });

  it("adopts no title when the final output carries no work item link", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    const result = await reconcileWorkItemTitleAsync(resolver, finalOutput());

    expect(result).toEqual({ reason: "no_work_item_url", retryable: false });
    expect(resolver.resolveAsync).not.toHaveBeenCalled();
  });

  it("survives an unparseable final output instead of failing the filed work item", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    await expect(
      reconcileWorkItemTitleAsync(resolver, "I created the issue for you!"),
    ).resolves.toEqual({ reason: "no_work_item_url", retryable: false });
  });

  it("marks a signed-out read retryable and a deleted item not", async () => {
    await expect(
      reconcileWorkItemTitleAsync(
        resolverReturning({ ok: false, reason: "unauthenticated" }),
        finalOutput("https://github.com/o/r/issues/42"),
      ),
    ).resolves.toMatchObject({ reason: "unauthenticated", retryable: true });

    await expect(
      reconcileWorkItemTitleAsync(
        resolverReturning({ ok: false, reason: "deleted" }),
        finalOutput("https://github.com/o/r/issues/42"),
      ),
    ).resolves.toMatchObject({ reason: "deleted", retryable: false });
  });

  it("returns no title on failure so callers keep the one they have", async () => {
    const result = await reconcileWorkItemTitleAsync(
      resolverReturning({ ok: false, reason: "transient" }),
      finalOutput("https://github.com/o/r/issues/42"),
    );

    expect(result.title).toBeUndefined();
  });
});
