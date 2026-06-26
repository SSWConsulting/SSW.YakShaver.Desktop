import type { InteractionRequest, ProjectSelectionPayload } from "@shared/types/user-interaction";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatErrorMessage } from "../../utils";
import { LoadingState } from "../common/LoadingState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

interface PromptSelectionDialogProps {
  request: InteractionRequest;
  onSubmit: (data: unknown) => Promise<void>;
  error?: string | null;
}

export function PromptSelectionDialog({
  request,
  onSubmit,
  error: pError,
}: PromptSelectionDialogProps) {
  const payload = request.payload as ProjectSelectionPayload;
  const { selectedProject: initialProject, allProjects } = payload;
  const autoApproveAt = request.autoApproveAt;

  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoApprovalCountdown, setAutoApprovalCountdown] = useState<number | null>(null);

  // View state: 'confirm' or 'select'
  const [view, setView] = useState<"confirm" | "select">("confirm");

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [tempSelectedProjectId, setTempSelectedProjectId] = useState<string | null>(null);

  const displayError = pError || localError;

  // Reset internal state when request changes
  useEffect(() => {
    if (!request) return;
    setSubmitting(false);
    setLocalError(null);
    setAutoApprovalCountdown(null);
    setView("confirm");
    setSearchQuery("");
    setTempSelectedProjectId(null);
  }, [request]);

  const resolveSelection = useCallback(
    async (projectId: string) => {
      setSubmitting(true);
      setLocalError(null);
      try {
        await onSubmit({ projectId });
      } catch (error) {
        setLocalError(formatErrorMessage(error));
        setSubmitting(false);
      }
    },
    [onSubmit],
  );

  // Auto-approval logic
  useEffect(() => {
    // If we're not in confirm view (user is changing project), stop countdown
    if (view !== "confirm") {
      setAutoApprovalCountdown(null);
      return;
    }

    if (!autoApproveAt) {
      setAutoApprovalCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const remainingMs = autoApproveAt - Date.now();
      setAutoApprovalCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 500);
    const timeoutDelay = Math.max(0, autoApproveAt - Date.now());

    const timeoutId = window.setTimeout(() => {
      // Only auto-approve if we are still in confirm view
      if (view === "confirm") {
        updateCountdown();
        void resolveSelection(initialProject.id);
      }
    }, timeoutDelay);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [autoApproveAt, resolveSelection, initialProject.id, view]);

  const lowerQuery = searchQuery.toLowerCase();
  const filteredProjects = allProjects
    .filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description?.toLowerCase().includes(lowerQuery),
    )
    .sort((a, b) => {
      // 1. Projects with name matches come first
      const aNameMatch = a.name.toLowerCase().includes(lowerQuery);
      const bNameMatch = b.name.toLowerCase().includes(lowerQuery);

      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;

      // 2. Alphabetical sort by name
      return a.name.localeCompare(b.name);
    });

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="sm:max-w-125">
        {view === "confirm" ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Do you want to proceed with the project?</AlertDialogTitle>
              <AlertDialogDescription>
                YakShaver analysed your video and selected the most relevant project prompt below.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="bg-secondary/20 p-4 rounded-md space-y-2 mt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-lg text-primary">{initialProject.name}</h3>
                <Badge variant="outline">
                  {initialProject.source === "local" ? "local" : "portal"}
                </Badge>
              </div>
              {initialProject.description && (
                <p className="text-sm text-muted-foreground">{initialProject.description}</p>
              )}
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  WHY THIS PROJECT:
                </p>
                <p className="text-sm italic text-foreground/80">{initialProject.reason}</p>
              </div>
            </div>

            {autoApprovalCountdown !== null && (
              <p className="text-xs text-yellow-500 font-medium">
                Auto-continuing in {autoApprovalCountdown}s...
              </p>
            )}

            {displayError && <p className="text-destructive text-sm font-medium">{displayError}</p>}

            <AlertDialogFooter className="mt-4">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault();
                  setView("select");
                }}
              >
                Change
              </Button>
              <AlertDialogAction
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault();
                  void resolveSelection(initialProject.id);
                }}
              >
                {submitting ? (
                  <>
                    <LoadingState />
                    Continuing...
                  </>
                ) : (
                  "Continue"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Select a Prompt</AlertDialogTitle>
              <AlertDialogDescription>
                Prompts are templates that control how YakShaver writes your issue. Select the one
                that best fits your project.{" "}
                <span className="text-foreground/60">
                  Local prompts are saved on your device; portal prompts are synced from YakShaver
                  Portal.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="mt-2 space-y-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search prompts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>

              <ScrollArea className="h-50 rounded-md border p-2">
                {filteredProjects.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    No prompts found.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className={`w-full text-left p-3 rounded-md transition-colors outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                          tempSelectedProjectId === project.id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-secondary focus:bg-secondary"
                        }`}
                        onClick={() => setTempSelectedProjectId(project.id)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{project.name}</span>
                          <Badge
                            variant="outline"
                            className={
                              tempSelectedProjectId === project.id
                                ? "border-primary-foreground/40 text-primary-foreground/80"
                                : undefined
                            }
                          >
                            {project.source === "local" ? "local" : "portal"}
                          </Badge>
                        </div>
                        {project.description && (
                          <div
                            className={`text-xs mt-1 ${
                              tempSelectedProjectId === project.id
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground"
                            }`}
                          >
                            {project.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {displayError && (
              <p className="text-destructive text-sm font-medium mt-2">{displayError}</p>
            )}

            <AlertDialogFooter className="mt-4">
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault();
                  setView("confirm");
                  setTempSelectedProjectId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={submitting || !tempSelectedProjectId}
                onClick={(e) => {
                  e.preventDefault();
                  if (tempSelectedProjectId) {
                    void resolveSelection(tempSelectedProjectId);
                  }
                }}
              >
                {submitting ? (
                  <>
                    <LoadingState />
                    Selecting...
                  </>
                ) : (
                  "Select Prompt"
                )}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
