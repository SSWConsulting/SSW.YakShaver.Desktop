import type { Cloud360Project, ShaveBlockReason } from "@shared/types/cloud360";
import { CircleAlert, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const BILLING_URL = "https://portal.yakshaver.ai/plan";

// Duplicated from shave-block-notice.ts in SSW.YakShaver — the repos ship separately, so keep the
// wording in step when either changes.
function getBlockCopy(reason: ShaveBlockReason) {
  if (reason === "no-subscription") {
    return {
      title: "No active subscription",
      body: "Your tenant doesn't have an active YakShaver plan, so recordings can't be processed. Choose a plan to start shaving.",
      actionLabel: "View plans",
    };
  }
  return {
    title: "Out of credits",
    body: "Your tenant has used all its YakShaver credits, so recordings can't be processed. Add credits or upgrade your plan to continue.",
    actionLabel: "Manage plan",
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (projectId: string) => void;
}

/** Centred empty state shown instead of the project list when the tenant cannot shave. */
function BlockedState({ reason, onAction }: { reason: ShaveBlockReason; onAction: () => void }) {
  const copy = getBlockCopy(reason);
  return (
    // <output> is the semantic element for role="status" — announced politely by screen readers
    // when the gate replaces the project list.
    <output className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <p className="font-semibold text-base">{copy.title}</p>
        <p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
          {copy.body}
        </p>
      </div>
      <Button size="sm" onClick={onAction}>
        {copy.actionLabel}
      </Button>
    </output>
  );
}

/** Searchable 360 project picker (mirrors the web ShaveProjectPickerDialog); selecting one proceeds immediately. */
export function Cloud360ProjectDialog({ open, onOpenChange, onConfirm }: Props) {
  const [projects, setProjects] = useState<Cloud360Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [blockReason, setBlockReason] = useState<ShaveBlockReason | null>(null);
  const [creditsChecked, setCreditsChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjects(null);
    setError(null);
    setQuery("");
    setBlockReason(null);
    setCreditsChecked(false);

    // Fetched alongside the projects so a user with credits waits on no extra round-trip
    // (issue #3899). The list still waits on creditsChecked below — projects rendered first, then
    // swapped out, would let a fast click slip through the gate.
    ipcClient.cloud360
      .checkCredits()
      .then((result) => {
        if (!cancelled && !result.canShave) setBlockReason(result.reason ?? "out-of-credits");
      })
      // Fails open like checkCredits itself: a broken pre-check must never stop someone recording.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCreditsChecked(true);
      });

    ipcClient.cloud360
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((err) => {
        if (!cancelled) setError(formatErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpenBilling = useCallback(() => {
    void ipcClient.app.openExternal(BILLING_URL);
  }, []);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const handleSelect = (projectId: string) => {
    onOpenChange(false);
    onConfirm(projectId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-white/10 bg-black/60 p-0 shadow-lg backdrop-blur-md sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Select a project</DialogTitle>
        </DialogHeader>
        {/* Search is pointless while blocked, and premature until the gate has answered. */}
        {blockReason === null && creditsChecked && (
          <div className="flex items-center gap-2 border-white/10 border-b px-3">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects..."
              autoFocus
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div className="cloud360-project-scroll max-h-[60vh] min-h-105 overflow-y-auto p-1">
          {blockReason !== null ? (
            // The list is withheld, not disabled: picking a project would only lead to a recording
            // we already know cannot be processed.
            <BlockedState reason={blockReason} onAction={handleOpenBilling} />
          ) : error ? (
            <div className="text-destructive py-6 text-center text-sm">{error}</div>
          ) : projects === null || !creditsChecked ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              Loading projects...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No GitHub project found. YakShaver Anywhere needs a GitHub-backed project.
            </div>
          ) : (
            filtered.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => handleSelect(project.id)}
                // Neutral translucent-white hover, matching the rest of the Desktop dark UI.
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded px-3 py-3 text-left hover:bg-white/10 hover:text-white"
              >
                <span className="font-medium">{project.name}</span>
                {project.githubRepo ? (
                  <span className="text-muted-foreground text-xs">{project.githubRepo}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
