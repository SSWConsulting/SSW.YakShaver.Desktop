import { formatDistanceToNow } from "date-fns";
import { Database, FileVideo } from "lucide-react";
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500";
      case "processing":
        return "text-blue-500";
      case "failed":
        return "text-red-500";
      default:
        return "text-yellow-500";
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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
            <FileVideo className="h-16 w-16 mb-4 opacity-50" />
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
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate">{shave.title}</h3>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileVideo className="h-3 w-3" />
                          {shave.videoFile.fileName}
                        </span>
                        <span>•</span>
                        <span>{formatDuration(shave.videoFile.duration)}</span>
                        {shave.projectName && (
                          <>
                            <span>•</span>
                            <span>{shave.projectName}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{shave.workItemSource}</span>
                      </div>
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
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(
                          shave.shaveStatus,
                        )}`}
                      >
                        {shave.shaveStatus}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(shave.createdAt), { addSuffix: true })}
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
