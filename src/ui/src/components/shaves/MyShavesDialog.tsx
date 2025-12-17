import { Database } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Shave } from "../../services/ipc-client";
import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

export function MyShavesDialog() {
  const [shaves, setShaves] = useState<Shave[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcClient.shave.getAll();
      setShaves(data);
    } catch (error) {
      toast.error("Failed to load shaves");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadShaves();
    }
  }, [open, loadShaves]);

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-chart-2/20 text-chart-2 border-chart-2/50";
      case "Processing":
        return "bg-chart-1/20 text-chart-1 border-chart-1/50";
      case "Failed":
        return "bg-destructive/20 text-destructive border-destructive/50";
      default:
        return "bg-chart-3/20 text-chart-3 border-chart-3/50";
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-10 w-10">
          <Database className="h-5 w-5" />
          <span className="sr-only">My Shaves</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>My Shaves</DialogTitle>
          <DialogDescription>View all your recorded and processed shaves</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : shaves.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Database className="h-16 w-16 mb-4 opacity-50" />
            <p className="text-lg">No shaves yet</p>
            <p className="text-sm">Start recording or upload a video to create your first shave</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {shaves.map((shave) => (
                <div
                  key={shave.id}
                  className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-lg truncate" title={shave.title}>
                        {shave.title}
                      </h3>
                      {shave.projectName && (
                        <div className="mt-2 text-sm text-muted-foreground truncate">
                          <span>{shave.projectName}</span>
                        </div>
                      )}
                      {shave.workItemUrl && (
                        <a
                          href={shave.workItemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline mt-1 inline-block"
                        >
                          View Work Item →
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span
                        className={`px-2 py-1 rounded border text-xs font-medium ${getStatusVariant(
                          shave.shaveStatus,
                        )}`}
                      >
                        {shave.shaveStatus}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
