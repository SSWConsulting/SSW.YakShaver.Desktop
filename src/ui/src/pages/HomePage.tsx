import { ExternalLink, LayoutGrid, List, RefreshCw, Square, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import HeadingTag from "@/components/typography/heading-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getYouTubeThumbnail, timeAgo } from "@/lib/utils";
import { LoadingState } from "../components/common/LoadingState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea, ScrollBar } from "../components/ui/scroll-area";
import { ipcClient } from "../services/ipc-client";
import type { BadgeVariant, ShaveItem } from "../types";

const NO_SHAVES_STEPS: string[] = [
  "Record screen and describe the issue",
  "AI transcribes and analyzes content",
  "Receive a structured work item ready to send",
];

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

const ShaveCardFooter = ({ shave }: { shave: ShaveItem }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {shave.projectName ? <Badge variant="outline">{shave.projectName}</Badge> : <span />}
        <span className="text-sm text-muted-foreground">
          {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
        <ShaveAction shave={shave} />
      </div>
    </div>
  );
};

const ShaveCard = ({ shave }: { shave: ShaveItem }) => {
  const thumbnail = shave.videoEmbedUrl ? getYouTubeThumbnail(shave.videoEmbedUrl) : null;
  const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;

  return (
    <div className="border border-white/20 rounded-lg overflow-hidden bg-black/30 backdrop-blur-sm flex flex-col h-full">
      {videoUrl ? (
        <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block">
          <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
            {thumbnail ? (
              <img src={thumbnail} alt={shave.title} className="w-full h-full object-cover" />
            ) : (
              <Video className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
        </a>
      ) : (
        <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
          <Video className="h-8 w-8 text-muted-foreground" />
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <h3 className="font-medium text-sm line-clamp-2" title={shave.title}>
          {shave.title}
        </h3>
      </div>
      <div className="px-4 pb-3 mt-auto">
        <ShaveCardFooter shave={shave} />
      </div>
    </div>
  );
};

const NoShaves = () => {
  return (
    <div className="flex flex-col items-center justify-center gap-6">
      <HeadingTag level={3}>You don't have any YakShaves yet!</HeadingTag>
      <div className="flex flex-col gap-6">
        {NO_SHAVES_STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-3">
            <span className="rounded-full border border-white/25 h-8 w-8 flex items-center justify-center text-sm font-medium">
              {index + 1}
            </span>
            <span className="font-light text-muted-foreground">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ShaveCards = ({ shaves }: { shaves: ShaveItem[] }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {shaves.map((shave) => (
        <ShaveCard key={shave.id} shave={shave} />
      ))}
    </div>
  );
};

const ShaveAction = ({ shave }: { shave: ShaveItem }) => {
  if (shave.shaveStatus === "Processing") {
    return (
      <Button variant="outline" size="sm" className="gap-1">
        <Square className="h-3 w-3" /> Stop
      </Button>
    );
  }
  if (shave.shaveStatus === "Failed") {
    return (
      <Button variant="outline" size="sm" className="gap-1">
        <RefreshCw className="h-3 w-3" /> Retry
      </Button>
    );
  }
  if (shave.workItemUrl) {
    return (
      <a href={shave.workItemUrl} target="_blank" rel="noopener noreferrer">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="View work item">
          <ExternalLink className="h-4 w-4" />
        </Button>
      </a>
    );
  }
  return null;
};

const ShaveTable = ({ shaves }: { shaves: ShaveItem[] }) => {
  return (
    <Table className="min-w-[800px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[120px]">Video</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[80px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shaves.map((shave) => (
          <TableRow key={shave.id}>
            <TableCell>
              {(() => {
                const thumbnail = shave.videoEmbedUrl
                  ? getYouTubeThumbnail(shave.videoEmbedUrl)
                  : null;
                const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;
                const Wrapper = videoUrl ? "a" : "div";
                return (
                  <Wrapper
                    className={`w-[100px] h-[56px] rounded bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden ${videoUrl ? "cursor-pointer" : "cursor-default opacity-50"}`}
                    {...(videoUrl
                      ? {
                          href: videoUrl,
                          target: "_blank",
                          rel: "noopener noreferrer",
                          title: "Open video",
                        }
                      : {})}
                  >
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt={shave.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Video className="h-5 w-5 text-muted-foreground" />
                    )}
                  </Wrapper>
                );
              })()}
            </TableCell>
            <TableCell className="font-medium max-w-[400px] truncate" title={shave.title}>
              {shave.title}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
            </TableCell>
            <TableCell className="text-muted-foreground max-w-[150px] truncate" title={shave.projectName || ""}>{shave.projectName || "—"}</TableCell>
            <TableCell>
              <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
            </TableCell>
            <TableCell>
              <ShaveAction shave={shave} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export function HomePage() {
  const [shaves, setShaves] = useState<ShaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shaveDisplayMode, setShaveDisplayMode] = useState<"table" | "card">("table");

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcClient.portal.getMyShaves();
      const items = result.data?.items ?? [];
      const sortedData = items.sort((a, b) => {
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
    loadShaves();
  }, [loadShaves]);

  if (loading) {
    return (
      <div className="z-10 relative flex flex-col items-center p-8">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="z-10 flex flex-col p-8 h-full gap-6 w-full min-w-0">
      <div className="flex items-start md:items-center flex-col md:flex-row justify-between gap-4">
        <HeadingTag level={1}>My Shaves</HeadingTag>
        <ToggleGroup
          className="p-1 border border-white/20 rounded-md"
          type="single"
          value={shaveDisplayMode}
          onValueChange={(v) => v && setShaveDisplayMode(v as "table" | "card")}
        >
          <ToggleGroupItem value="table" aria-label="Table view">
            <List className="h-4 w-4" />
            {shaveDisplayMode === "table" ? "Table view" : ""}
          </ToggleGroupItem>
          <ToggleGroupItem value="card" aria-label="Card view">
            <LayoutGrid className="h-4 w-4" />
            {shaveDisplayMode === "card" ? "Card view" : ""}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ScrollArea className="flex-1">
        {shaves.length === 0 ? (
          <NoShaves />
        ) : shaveDisplayMode === "card" ? (
          <ShaveCards shaves={shaves} />
        ) : (
          <ShaveTable shaves={shaves} />
        )}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
