import type { Cloud360Project } from "@shared/types/cloud360";
import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (projectId: string) => void;
}

export function Cloud360ProjectDialog({ open, onOpenChange, onConfirm }: Props) {
  const [projects, setProjects] = useState<Cloud360Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjects(null);
    setError(null);
    setSelected("");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a project</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-red-400/90">{error}</p>}
        {!error && projects === null && <p className="text-sm text-white/60">Loading projects…</p>}
        {!error && projects?.length === 0 && (
          <p className="text-sm text-white/60">
            No GitHub project found. YakShaver 360 needs a GitHub-backed project.
          </p>
        )}
        {!error && projects && projects.length > 0 && (
          <select
            className="w-full rounded border border-white/10 bg-black/30 p-2 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              onConfirm(selected);
              onOpenChange(false);
            }}
          >
            Start recording
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
