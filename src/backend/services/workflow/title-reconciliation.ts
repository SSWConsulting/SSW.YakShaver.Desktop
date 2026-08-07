import { readReportedTitle, readWorkItemUrl } from "../../../shared/utils/final-output";
import { withTimeout } from "../../utils/async-utils";
import type {
  BacklogItemResolution,
  BacklogItemResolver,
  BacklogResolveFailure,
} from "../backlog/backlog-item-resolver";
import { parseBacklogItemUrl } from "../backlog/backlog-item-resolver";
import type { BacklogArtifact } from "../mcp/backlog-orchestrator";
import { TelemetryService } from "../telemetry/telemetry-service";

/**
 * Wall-clock cap on one title read. Generous enough for a cold MCP connection, short enough that a
 * user is not left watching a work item that was already filed.
 */
const READ_TIMEOUT_MS = 15_000;

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
 * The judge is explicitly allowed to report "an id, a number, or a URL", so an artifact is often
 * just `"5"` and cannot be read directly; the model's own `URL` is the usable link in that case.
 * But that URL is model-produced, and the read that follows runs with the user's MCP credentials
 * and without the tool-approval prompt — so it is accepted ONLY when an artifact identifies the
 * same item. A model cannot then point the read at an unrelated item and have its title adopted.
 *
 * Residual: when every artifact is a bare id, a URL for a DIFFERENT repository whose item number
 * happens to coincide would still corroborate. Closing that needs a repo-qualified artifact, which
 * the judge does not promise.
 */
export function selectWorkItemUrl(
  artifacts: readonly BacklogArtifact[] | undefined,
  finalOutput: string | undefined,
): string | undefined {
  // Tool-result evidence that is itself readable needs no corroboration — it IS the evidence.
  const evidenceUrl = (artifacts ?? []).find((artifact) => parseBacklogItemUrl(artifact.idOrUrl));
  if (evidenceUrl) {
    return evidenceUrl.idOrUrl;
  }

  const reportedUrl = readWorkItemUrl(finalOutput);
  const reportedRef = reportedUrl ? parseBacklogItemUrl(reportedUrl) : undefined;
  if (!reportedUrl || !reportedRef) {
    return undefined;
  }

  const identifier = reportedRef.values.number ?? reportedRef.values.id ?? reportedRef.values.key;
  const corroborated = (artifacts ?? []).some((artifact) =>
    mentionsIdentifier(artifact.idOrUrl, identifier),
  );

  return corroborated ? reportedUrl : undefined;
}

/** Does this artifact name the same item? Tolerates `5`, `#5`, `AB#1234`, `YAK-7`, and prose. */
function mentionsIdentifier(artifact: string, identifier: string | undefined): boolean {
  if (!identifier) {
    return false;
  }
  const tokens: readonly string[] = artifact.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  return tokens.includes(identifier.toLowerCase());
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
    // Tracked like every other failure, and for a sharper reason than the rest: this is the path
    // taken when nothing corroborated a work item, so it is the one that separates "reconciliation
    // is working" from "reconciliation has never once fired". Silent here, and the post-merge
    // numbers could not tell those apart — nor size the backfill this PR leaves out of scope.
    TelemetryService.getInstance().trackEvent({
      name: "WorkItemTitleReconciliation",
      properties: { outcome: "unresolved", reason: "no_work_item_url" },
    });
    return { title: reportedTitle, reason: "no_work_item_url" };
  }

  // The work item is already filed at this point. A reader that stalls must not hold the workflow
  // open behind it — the checkpoint, the portal write, the metadata stage and temp-file cleanup all
  // run after this call, so an unbounded await would strand a run that actually succeeded.
  let resolution: BacklogItemResolution;
  try {
    resolution = await withTimeout(
      resolver.resolveAsync(workItemUrl, serverFilter),
      READ_TIMEOUT_MS,
      "work item title read",
    );
  } catch (error) {
    console.warn(
      "[TitleReconciliation] Title read did not complete; keeping the reported title:",
      error instanceof Error ? error.message : String(error),
    );
    TelemetryService.getInstance().trackEvent({
      name: "WorkItemTitleReconciliation",
      properties: { outcome: "unresolved", reason: "transient" },
    });
    return { title: reportedTitle, reason: "transient" };
  }

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
