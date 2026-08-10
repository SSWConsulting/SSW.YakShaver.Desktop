import { beforeEach, describe, expect, it, vi } from "vitest";

// One shared spy rather than a fresh one per getInstance(), so what was tracked can be asserted:
// every failure of this feature degrades silently to the previous title, which makes telemetry the
// only way to tell a working reconciliation from one that has never fired.
const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: { getInstance: () => ({ trackEvent }) },
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

beforeEach(() => {
  trackEvent.mockClear();
});

describe("selectWorkItemUrl", () => {
  it("prefers the judge's tool-result evidence over the model's narration", () => {
    expect(
      selectWorkItemUrl(
        [{ type: "issue", idOrUrl: "https://github.com/o/r/issues/7" }],
        finalOutput(ISSUE_URL),
      ),
    ).toBe("https://github.com/o/r/issues/7");
  });

  it("falls through a BARE ID artifact to the URL that names the same item", () => {
    // The judge is explicitly allowed to report "an id, a number, or a URL", so an artifact is
    // often just "42" and cannot be read directly; the model's URL is the usable link.
    expect(selectWorkItemUrl([{ type: "issue", idOrUrl: "42" }], finalOutput(ISSUE_URL))).toBe(
      ISSUE_URL,
    );
  });

  it("refuses a model URL that no artifact corroborates", () => {
    // The read runs with the user's credentials and without an approval prompt, so a model must
    // not be able to point it at an item the tool results never mentioned.
    expect(
      selectWorkItemUrl([{ type: "issue", idOrUrl: "5" }], finalOutput(ISSUE_URL)),
    ).toBeUndefined();
  });

  it("recognises the item id inside a decorated artifact", () => {
    expect(
      selectWorkItemUrl(
        [{ type: "work_item", idOrUrl: "AB#1234" }],
        finalOutput("https://dev.azure.com/ssw/YakShaver/_workitems/edit/1234"),
      ),
    ).toBe("https://dev.azure.com/ssw/YakShaver/_workitems/edit/1234");
  });

  it("skips an artifact that is not a backlog item", () => {
    expect(
      selectWorkItemUrl(
        [
          { type: "pull_request", idOrUrl: "https://github.com/o/r/pull/9" },
          { type: "issue", idOrUrl: "42" },
        ],
        finalOutput(ISSUE_URL),
      ),
    ).toBe(ISSUE_URL);
  });

  it("returns undefined when there is no usable URL at all", () => {
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
      artifacts: [{ type: "issue", idOrUrl: "42" }],
      finalOutput: finalOutput(ISSUE_URL),
    });

    expect(result).toEqual({ title: "🐛 The title that is actually on the issue" });
  });

  it("falls back to the reported title when the read fails", async () => {
    // The regression this guards: dropping this fallback left the shave showing the recording's
    // file name, which is worse than what the workflow did before reconciliation existed.
    const result = await reconcileWorkItemTitleAsync(
      resolverReturning({ ok: false, reason: "unauthenticated" }),
      { artifacts: [{ type: "issue", idOrUrl: "42" }], finalOutput: finalOutput(ISSUE_URL) },
    );

    expect(result).toEqual({ title: REPORTED_TITLE, reason: "unauthenticated" });
  });

  it("falls back to the reported title when there is no work item link at all", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    const result = await reconcileWorkItemTitleAsync(resolver, { finalOutput: finalOutput() });

    expect(result).toEqual({ title: REPORTED_TITLE, reason: "no_work_item_url" });
    expect(resolver.resolveAsync).not.toHaveBeenCalled();
  });

  it("reports the no-link path to telemetry like every other failure", async () => {
    // Untracked, this path is invisible — and it is the one that answers "has reconciliation ever
    // fired?", since it covers a model that reported no URL and artifacts that were all bare ids.
    await reconcileWorkItemTitleAsync(
      resolverReturning({ ok: true, platform: "github", title: "unused" }),
      { finalOutput: finalOutput() },
    );

    expect(trackEvent).toHaveBeenCalledWith({
      name: "WorkItemTitleReconciliation",
      properties: { outcome: "unresolved", reason: "no_work_item_url" },
    });
  });

  it("survives an unparseable final output instead of failing the filed work item", async () => {
    const resolver = resolverReturning({ ok: true, platform: "github", title: "unused" });

    await expect(
      reconcileWorkItemTitleAsync(resolver, { finalOutput: "I created the issue for you!" }),
    ).resolves.toEqual({ title: undefined, reason: "no_work_item_url" });
  });

  it("keeps the reported title when the read stalls instead of holding the workflow open", async () => {
    // Everything after this call — the checkpoint, the portal write, the metadata stage, temp-file
    // cleanup — runs for a work item that was ALREADY filed, so a hung reader must not strand it.
    vi.useFakeTimers();
    try {
      const resolver: BacklogItemResolver = { resolveAsync: () => new Promise(() => {}) };

      const pending = reconcileWorkItemTitleAsync(resolver, {
        artifacts: [{ type: "issue", idOrUrl: "42" }],
        finalOutput: finalOutput(ISSUE_URL),
      });
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toEqual({ title: REPORTED_TITLE, reason: "transient" });
    } finally {
      vi.useRealTimers();
    }
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
