import type { Cloud360Project } from "@shared/types/cloud360";
import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (projectId: string) => void;
}

/**
 * Project picker for YakShaver 360, mirroring the web frontend's
 * ShaveProjectPickerDialog: a searchable command list where selecting a project
 * immediately proceeds (here: fires onConfirm + closes; web navigates to /record).
 */
export function Cloud360ProjectDialog({ open, onOpenChange, onConfirm }: Props) {
  const [projects, setProjects] = useState<Cloud360Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjects(null);
    setError(null);
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
        {/* Transparent so the DialogContent's blurred-black surface shows through
            (Command defaults to an opaque bg-popover). */}
        <Command className="bg-transparent [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-3">
          <CommandInput placeholder="Search projects..." />
          <CommandList className="cloud360-project-scroll max-h-[60vh] min-h-[420px]">
            {error ? (
              <div className="text-destructive py-6 text-center text-sm">{error}</div>
            ) : projects === null ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                Loading projects...
              </div>
            ) : (
              <>
                <CommandEmpty>
                  No GitHub project found. YakShaver 360 needs a GitHub-backed project.
                </CommandEmpty>
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.name}
                    onSelect={() => handleSelect(project.id)}
                    // Override the default bg-accent highlight (Desktop's --accent is a
                    // warm brown) with a neutral translucent-white hover, matching the
                    // rest of the Desktop dark UI.
                    className="flex cursor-pointer flex-col items-start gap-0.5 data-[selected=true]:bg-white/10 data-[selected=true]:text-white"
                  >
                    <span className="font-medium">{project.name}</span>
                    {project.githubRepo ? (
                      <span className="text-muted-foreground text-xs">{project.githubRepo}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
