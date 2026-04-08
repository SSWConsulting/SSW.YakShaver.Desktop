import { Database, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "../components/common/LoadingState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import { ScrollArea } from "../components/ui/scroll-area";
import { ipcClient } from "../services/ipc-client";
import type { BadgeVariant, Shave } from "../types";

export function HomePage() {
  const [shaves, setShaves] = useState<Shave[]>([]);
  const [loading, setLoading] = useState(true);

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcClient.shave.getAll();
      const sortedData =
        result.data?.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt).getTime();
          const dateB = new Date(b.updatedAt || b.createdAt).getTime();
          return dateB - dateA;
        }) ?? [];
      setShaves(sortedData);
    } catch (error) {
      toast.error("Failed to load shaves");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShaves();
  }, [loadShaves]);

  const getStatusVariant = (status: string): BadgeVariant => {
    switch (status) {
      case "Completed":
        return "success";
      case "Cancelled":
        return "secondary";
      case "Processing":
        return "secondary";
      case "Failed":
        return "destructive";
      default:
        return "default";
    }
  };

  if (loading) {
    return (
      <div className="z-10 relative flex flex-col items-center p-8">
        <LoadingState />
      </div>
    );
  }

  if (shaves.length === 0) {
    return (
      <div className="z-10 relative flex flex-col items-center p-8">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database />
            </EmptyMedia>
            <EmptyTitle>No shaves yet</EmptyTitle>
            <EmptyDescription>
              Start recording or upload a video to create your first shave
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="z-10 relative flex flex-col p-8 h-full">
      <h1 className="text-2xl font-semibold mb-6">My Shaves</h1>
      <ScrollArea className="flex-1">
        <div className="space-y-3 max-w-3xl">
          {shaves.map((shave) => (
            <div key={shave.id} className="border border-white/20 rounded-lg p-4 max-w-full overflow-hidden bg-black/30 backdrop-blur-sm">
              <div className="flex gap-3 items-start min-w-0">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!shave.videoEmbedUrl}
                  onClick={() => {
                    if (shave.videoEmbedUrl) {
                      window.open(shave.videoEmbedUrl, "_blank");
                    }
                  }}
                  title={shave.videoEmbedUrl ? "Open video" : "No video available"}
                >
                  <Video className="h-5 w-5" />
                </Button>
                <div className="w-0 flex-1">
                  <h3
                    className="font-semibold text-base mb-1 overflow-hidden text-ellipsis whitespace-nowrap"
                    title={shave.title}
                  >
                    {shave.title}
                  </h3>
                  <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground mb-2">
                    <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
                    <span>•</span>
                    <span className="whitespace-nowrap">
                      {new Date(shave.updatedAt || shave.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {shave.workItemUrl && (
                    <div className="text-xs mb-1 truncate">
                      <span className="text-muted-foreground">Backlog: </span>
                      <a
                        href={shave.workItemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        View Backlog
                      </a>
                    </div>
                  )}
                  {shave.projectName && (
                    <div className="text-xs text-muted-foreground truncate">
                      Project: <span className="text-foreground">{shave.projectName}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
