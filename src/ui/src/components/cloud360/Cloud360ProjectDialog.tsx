import type { Cloud360Project } from "@shared/types/cloud360";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (projectId: string) => void;
}

/**
 * Project picker for YakShaver 360, mirroring the web frontend's
 * ShaveProjectPickerDialog: a searchable list where selecting a project
 * immediately proceeds (here: fires onConfirm + closes; web navigates to /record).
 */
export function Cloud360ProjectDialog({ open, onOpenChange, onConfirm }: Props) {
  const [projects, setProjects] = useState<Cloud360Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjects(null);
    setError(null);
    setQuery("");
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
        <div className="cloud360-project-scroll max-h-[60vh] min-h-105 overflow-y-auto p-1">
          {error ? (
            <div className="text-destructive py-6 text-center text-sm">{error}</div>
          ) : projects === null ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              Loading projects...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No GitHub project found. YakShaver 360 needs a GitHub-backed project.
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
