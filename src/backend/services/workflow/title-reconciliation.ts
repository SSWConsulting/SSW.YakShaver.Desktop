import { readWorkItemUrl } from "../../../shared/utils/final-output";
import type { BacklogItemResolver, BacklogResolveFailure } from "../backlog/backlog-item-resolver";
import { TelemetryService } from "../telemetry/telemetry-service";

/** Why no authoritative title was adopted. `no_work_item_url` means there was nothing to read. */
export type TitleReconciliationFailure = BacklogResolveFailure | "no_work_item_url";

export interface TitleReconciliation {
  /** The title read back from the work item. Present only when the read succeeded. */
  title?: string;
  reason?: TitleReconciliationFailure;
  /** True when a later attempt could still succeed — the input to any retry/backfill pass. */
  retryable: boolean;
}

/**
 * A signed-out connection or an unhealthy server can be fixed and retried; a deleted item or a URL
 * we do not recognise cannot. Retrying the second group forever is as wrong as giving up on the first.
 */
const RETRYABLE: ReadonlySet<TitleReconciliationFailure> = new Set([
  "transient",
  "unauthenticated",
  "no_read_tool",
]);

/**
 * Read the work item's CURRENT title so everything YakShaver owns can follow it.
 *
 * Called after the backlog action succeeded, regardless of WHICH action ran — create, update of a
 * duplicate, comment, or transition. That is the point: the reconciliation does not need to know
 * what happened, only which item the run ended up linked to.
 *
 * Best-effort by construction. A work item that was genuinely created must never be reported as a
 * failed run because we could not read its title back afterwards, so every failure path here
 * returns a reason instead of throwing.
 */
export async function reconcileWorkItemTitleAsync(
  resolver: BacklogItemResolver,
  finalOutput: string | undefined,
  serverFilter?: string[],
): Promise<TitleReconciliation> {
  const workItemUrl = readWorkItemUrl(finalOutput);
  if (!workItemUrl) {
    return { reason: "no_work_item_url", retryable: false };
  }

  const resolution = await resolver.resolveAsync(workItemUrl, serverFilter);

  if (resolution.ok) {
    TelemetryService.getInstance().trackEvent({
      name: "WorkItemTitleReconciliation",
      properties: { outcome: "resolved", platform: resolution.platform },
    });
    return { title: resolution.title, retryable: false };
  }

  console.warn(
    `[TitleReconciliation] Could not read the work item title (${resolution.reason})` +
      `${resolution.detail ? `: ${resolution.detail}` : ""}. Keeping the current title.`,
  );
  TelemetryService.getInstance().trackEvent({
    name: "WorkItemTitleReconciliation",
    properties: { outcome: "unresolved", reason: resolution.reason },
  });

  return { reason: resolution.reason, retryable: RETRYABLE.has(resolution.reason) };
}
