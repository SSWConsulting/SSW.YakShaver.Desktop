import { describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: { getInstance: () => ({ trackEvent: vi.fn() }) },
}));

import type { BacklogItemResolver } from "../backlog/backlog-item-resolver";
import { reconcileWorkItemTitleAsync, selectWorkItemUrl } from "./title-reconciliation";

const REPORTED_TITLE = "Title the model reported filing";
const ISSUE_URL = "https://github.com/o/r/issues/42";

const finalOutput = (url?: string, title: string | undefined = REPORTED_TITLE) =>
  JSON.stringify({
    Status: "Success",
    ...(title ? { Title: title } : {}),
    ...(url ? { URL: url } : {}),
  });

const resolverReturning = (
  resolution: Awaited<ReturnType<BacklogItemResolver["resolveAsync"]>>,
): BacklogItemResolver => ({ resolveAsync: vi.fn().mockResolvedValue(resolution) });

describe("selectWorkItemUrl", () => {
  it("prefers the judge's tool-result evidence over the model's narration", () => {
    expect(
      selectWorkItemUrl(
        [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/7" }],
        finalOutput(ISSUE_URL),
      ),
    ).toBe("https://github.com/o/r/issues/7");
  });

  it("falls through a BARE ID artifact to the usable URL", () => {
    // The judge is explicitly allowed to report "an id, a number, or a URL", so `artifacts[0]` is
    // often just "5". A `??` fallback would stop there and never try the link that actually works.
    expect(selectWorkItemUrl([{ type: "issue", idOrUrl: "5" }], finalOutput(ISSUE_URL))).toBe(
      ISSUE_URL,
    );
  });

  it("skips an artifact that is not a backlog item", () => {
    expect(
      selectWorkItemUrl(
        [{ type: "pull_request", idOrUrl: "https://github.com/o/r/pull/9" }],
        finalOutput(ISSUE_URL),
      ),
    ).toBe(ISSUE_URL);
  });

  it("returns undefined when no candidate is a work item URL", () => {
    expect(selectWorkItemUrl([{ type: "issue", idOrUrl: "5" }], finalOutput())).toBeUndefined();
  });
});

describe("reconcileWorkItemTitleAsync", () => {
  it("adopts the work item's title over the one the model reported", async () => {
    const resolver = resolverReturning({
      ok: true,
      platform: "github",
      title: "🐛 The title that is actually on the issue",
    });

    const result = await reconcileWorkItemTitleAsync(resolver, {
      finalOutput: finalOutput(ISSUE_URL),
    });

    expect(result).toEqual({ title: "🐛 The title that is actually on the issue" });
  });

  it("falls back to the reported title when the read fails", async () => {
    // The regression this guards: dropping this fallback left the shave showing the recording's
    // file name, which is worse than what the workflow did before reconciliation existed.
    const result = await reconcileWorkItemTitleAsync(
      resolverReturning({ ok: false, reason: "unauthenticated" }),
      { finalOutput: finalOutput(ISSUE_URL) },
    );

    expect(result).toEqual({ title: REPORTED_TITLE, reason: "unauthenticated" });
  });

  it("falls back to the reported title when there is no work item link at all", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    const result = await reconcileWorkItemTitleAsync(resolver, { finalOutput: finalOutput() });

    expect(result).toEqual({ title: REPORTED_TITLE, reason: "no_work_item_url" });
    expect(resolver.resolveAsync).not.toHaveBeenCalled();
  });

  it("survives an unparseable final output instead of failing the filed work item", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    await expect(
      reconcileWorkItemTitleAsync(resolver, { finalOutput: "I created the issue for you!" }),
    ).resolves.toEqual({ title: undefined, reason: "no_work_item_url" });
  });

  it("reads the artifact URL, not the narration URL, when both are usable", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "t" });

    await reconcileWorkItemTitleAsync(resolver, {
      artifacts: [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/7" }],
      finalOutput: finalOutput(ISSUE_URL),
      serverFilter: ["github"],
    });

    expect(resolver.resolveAsync).toHaveBeenCalledWith("https://github.com/o/r/issues/7", [
      "github",
    ]);
  });
});
