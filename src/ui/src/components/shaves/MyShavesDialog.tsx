import { Database, Video, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import type { BadgeVariant, Shave } from "../../types";
import { LoadingState } from "../common/LoadingState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";

export function MyShavesDialog() {
  const [shaves, setShaves] = useState<Shave[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcClient.shave.getAll();
      // Sort by updatedAt, newest first
      const sortedData = data.sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateB - dateA;
      });
      setShaves(sortedData);
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

  const getStatusVariant = (status: string): BadgeVariant => {
    switch (status) {
      case "Completed":
        return "success";
      case "Processing":
        return "secondary";
      case "Failed":
        return "destructive";
      default:
        return "default";
    }
  };

  const renderEmptyState = () => (
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
  );

  const renderShavesContent = () => (
    <ScrollArea className="h-full">
      <div className="space-y-3">
        {shaves.map((shave) => (
          <div key={shave.id} className="border rounded-lg p-4 max-w-full overflow-hidden">
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
  );

  const renderContent = () => {
    if (loading) {
      return <LoadingState />;
    }

    if (shaves.length === 0) {
      return renderEmptyState();
    }

    return renderShavesContent();
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <DrawerTrigger asChild>
        <Button size="sm" className="flex items-center gap-2" aria-label="Open My Shaves">
          <Database className="h-4 w-4" />
          <span>My Shaves</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="h-screen top-0 right-0 left-auto mt-0 w-[40%] rounded-none">
        <div className="flex flex-col h-full">
          <DrawerHeader className="border-b">
            <div className="flex items-center justify-between">
              <div>
                <DrawerTitle>My Shaves</DrawerTitle>
                <DrawerDescription>View all your recorded and processed shaves</DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="flex-1 overflow-hidden p-4">{renderContent()}</div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
