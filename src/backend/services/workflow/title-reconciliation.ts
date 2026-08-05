import { readReportedTitle, readWorkItemUrl } from "../../../shared/utils/final-output";
import type { BacklogItemResolver, BacklogResolveFailure } from "../backlog/backlog-item-resolver";
import { parseBacklogItemUrl } from "../backlog/backlog-item-resolver";
import type { BacklogArtifact } from "../mcp/backlog-orchestrator";
import { TelemetryService } from "../telemetry/telemetry-service";

/** Why the title did not come from the work item itself. `no_work_item_url`: nothing to read. */
export type TitleReconciliationFailure = BacklogResolveFailure | "no_work_item_url";

export interface TitleReconciliation {
  /**
   * The title every YakShaver-owned record should carry: read from the work item when that
   * succeeded, otherwise the title the orchestrator reported filing. Undefined only when neither
   * exists, in which case callers keep whatever title they already had.
   */
  title?: string;
  /** Absent when the title came from the work item. Present = why the read did not happen/succeed. */
  reason?: TitleReconciliationFailure;
}

export interface TitleReconciliationInput {
  /**
   * Work item evidence the outcome judge extracted from tool RESULTS. Preferred over the model's
   * own narration, since #833 established that the narration cannot be trusted for what was filed.
   */
  artifacts?: readonly BacklogArtifact[];
  /** The orchestrator's final message — carries both the fallback URL and the fallback title. */
  finalOutput?: string;
  /** The project's selected MCP servers, so the read uses the run's own identity and restriction. */
  serverFilter?: string[];
}

/**
 * Choose which work item to read, preferring judge-extracted evidence over the model's narration.
 *
 * Every candidate is validated by actually parsing it, not by assuming the first one is usable: the
 * judge is explicitly allowed to report "an id, a number, or a URL", so `artifacts[0]` may be `"5"`,
 * and its free-form `type` may point at a comment or a pull request. Taking the first candidate
 * that parses as a backlog item URL is what keeps a bare id from shadowing a perfectly good link.
 */
export function selectWorkItemUrl(
  artifacts: readonly BacklogArtifact[] | undefined,
  finalOutput: string | undefined,
): string | undefined {
  const candidates: (string | undefined)[] = [
    ...(artifacts ?? []).map((artifact) => artifact.idOrUrl),
    readWorkItemUrl(finalOutput),
  ];

  return candidates.find((candidate) => candidate && parseBacklogItemUrl(candidate));
}

/**
 * Read the work item's CURRENT title so everything YakShaver owns can follow it.
 *
 * Called after the backlog action succeeded, regardless of WHICH action ran — create, update of a
 * duplicate, comment, or transition. That is the point: the reconciliation does not need to know
 * what happened, only which item the run ended up linked to.
 *
 * Best-effort by construction. A work item that was genuinely created must never be reported as a
 * failed run because we could not read its title back afterwards, so every failure path returns the
 * reported title with a reason instead of throwing.
 */
export async function reconcileWorkItemTitleAsync(
  resolver: BacklogItemResolver,
  { artifacts, finalOutput, serverFilter }: TitleReconciliationInput,
): Promise<TitleReconciliation> {
  const reportedTitle = readReportedTitle(finalOutput);
  const workItemUrl = selectWorkItemUrl(artifacts, finalOutput);

  if (!workItemUrl) {
    return { title: reportedTitle, reason: "no_work_item_url" };
  }

  const resolution = await resolver.resolveAsync(workItemUrl, serverFilter);

  if (resolution.ok) {
    TelemetryService.getInstance().trackEvent({
      name: "WorkItemTitleReconciliation",
      properties: { outcome: "resolved", platform: resolution.platform },
    });
    return { title: resolution.title };
  }

  console.warn(
    `[TitleReconciliation] Could not read the work item title (${resolution.reason})` +
      `${resolution.detail ? `: ${resolution.detail}` : ""}. Falling back to the reported title.`,
  );
  TelemetryService.getInstance().trackEvent({
    name: "WorkItemTitleReconciliation",
    properties: { outcome: "unresolved", reason: resolution.reason },
  });

  return { title: reportedTitle, reason: resolution.reason };
}
