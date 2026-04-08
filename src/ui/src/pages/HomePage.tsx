import { ExternalLink, LayoutGrid, List, RefreshCw, Square, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "../components/common/LoadingState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { ipcClient } from "../services/ipc-client";
import type { BadgeVariant, ShaveItem } from "../types";
import HeadingTag from "@/components/ui/heading-tag";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NO_SHAVES_STEPS: string[] = ["Record screen and describe the issue", "AI transcribes and analyzes content", "Receive a structured work item ready to send"]

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

const ShaveCard = ({ shave }: { shave: ShaveItem }) => {
  return (
    <div
      key={shave.id}
      className="border border-white/20 rounded-lg p-4 max-w-full overflow-hidden bg-black/30 backdrop-blur-sm"
    >
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
            <Badge variant={getStatusVariant(shave.shaveStatus)}>
              {shave.shaveStatus}
            </Badge>
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
              Project:{" "}
              <span className="text-foreground">{shave.projectName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const NoShaves = () => {
  return (
    <div className='flex flex-col items-center justify-center gap-6'>
      <HeadingTag level={3}>You don't have any YakShaves yet!</HeadingTag>
      <div className='flex flex-col gap-6'>
      {NO_SHAVES_STEPS.map((step, index) => (
        <div key={index} className='flex items-center gap-3'>
          <span className='rounded-full border border-white/25 h-8 w-8 flex items-center justify-center text-sm font-medium'>{index + 1}</span>
          <span className='font-light text-muted-foreground'>{step}</span>
        </div>
      ))}
      </div>
    </div>
  )
}

const ShaveCards = ({ shaves }: { shaves: ShaveItem[] }) => {
  return (
    <div className='flex flex-col gap-4'>
      {shaves.map((shave) => (
        <ShaveCard key={shave.id} shave={shave} />
      ))}
    </div>
  )
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hrs ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}

const ShaveStatusAction = ({ shave }: { shave: ShaveItem }) => {
  if (shave.shaveStatus === "Processing") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
        <Button variant="outline" size="sm" className="gap-1">
          <Square className="h-3 w-3" /> Stop
        </Button>
      </div>
    );
  }
  if (shave.shaveStatus === "Failed") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
        <Button variant="outline" size="sm" className="gap-1">
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {shave.workItemUrl && (
        <a href={shave.workItemUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="View work item">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}
    </div>
  );
};

const ShaveTable = ({ shaves }: { shaves: ShaveItem[] }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[120px]">Video</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Location</TableHead>
          <TableHead className="w-[160px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shaves.map((shave) => (
          <TableRow key={shave.id}>
            <TableCell>
              <div
                className="w-[100px] h-[56px] rounded bg-black/40 border border-white/10 flex items-center justify-center cursor-pointer"
                onClick={() => shave.videoEmbedUrl && window.open(shave.videoEmbedUrl, "_blank")}
                title={shave.videoEmbedUrl ? "Open video" : "No video"}
              >
                <Video className="h-5 w-5 text-muted-foreground" />
              </div>
            </TableCell>
            <TableCell className="font-medium max-w-[400px] truncate" title={shave.title}>
              {shave.title}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {shave.projectName || "—"}
            </TableCell>
            <TableCell>
              <ShaveStatusAction shave={shave} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}


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
    <div className="z-10 flex flex-col p-8 h-full gap-6">
      <div className='flex items-center justify-between'>
        <HeadingTag level={1}>My Shaves</HeadingTag>
        <ToggleGroup className='p-1 border border-white/20 rounded-md' type="single" value={shaveDisplayMode} onValueChange={(v) => v && setShaveDisplayMode(v as "table" | "card")}>
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
        <div className="">
          {shaves.length === 0 ? (
            <NoShaves />
          ) : (
            shaveDisplayMode === "card" ? <ShaveCards shaves={shaves} /> : <ShaveTable shaves={shaves} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
