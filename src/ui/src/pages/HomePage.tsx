import {
  ExternalLink,
  LayoutGrid,
  List,
  RefreshCw,
  Square,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "../components/common/LoadingState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea, ScrollBar } from "../components/ui/scroll-area";
import { ipcClient } from "../services/ipc-client";
import type { BadgeVariant, ShaveItem } from "../types";
import HeadingTag from "@/components/ui/heading-tag";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getYouTubeThumbnail, timeAgo } from "@/lib/utils";

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
  if (shave.shaveStatus === "Processing") {
    return (
      <>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(shave.shaveStatus)}>
            {shave.shaveStatus}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
          </span>
        </div>
        <Button variant="outline" size="sm" className="gap-1">
          <Square className="h-3 w-3" /> Stop
        </Button>
      </>
    );
  }
  if (shave.shaveStatus === "Failed") {
    return (
      <>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(shave.shaveStatus)}>
            YakShave Failed
          </Badge>
          <span className="text-sm text-muted-foreground">
            {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
          </span>
        </div>
        <Button variant="outline" size="sm" className="gap-1">
          <RefreshCw className="h-3 w-3" /> Redo
        </Button>
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2">
        {shave.projectName && (
          <Badge variant="outline">{shave.projectName}</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
        </span>
      </div>
      {shave.workItemUrl && (
        <a href={shave.workItemUrl} target="_blank" rel="noopener noreferrer">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="View work item"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}
    </>
  );
};

const ShaveCard = ({ shave }: { shave: ShaveItem }) => {
  const thumbnail = shave.videoEmbedUrl
    ? getYouTubeThumbnail(shave.videoEmbedUrl)
    : null;
  const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;

  return (
    <div className="border border-white/20 rounded-lg overflow-hidden bg-black/30 backdrop-blur-sm">
      {videoUrl ? (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={shave.title}
                className="w-full h-full object-cover"
              />
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

      <div className="flex flex-col gap-2 px-4 pb-3 pt-4 h-full my-auto ">
          <h3 className="font-medium text-sm line-clamp-2" title={shave.title}>
            {shave.title}
          </h3>
          <div className="flex items-center justify-between">
          <ShaveCardFooter shave={shave} />
          </div>
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
          <div key={index} className="flex items-center gap-3">
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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {shaves.map((shave) => (
        <ShaveCard key={shave.id} shave={shave} />
      ))}
    </div>
  );
};

const ShaveStatusAction = ({ shave }: { shave: ShaveItem }) => {
  if (shave.shaveStatus === "Processing") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>
          {shave.shaveStatus}
        </Badge>
        <Button variant="outline" size="sm" className="gap-1">
          <Square className="h-3 w-3" /> Stop
        </Button>
      </div>
    );
  }
  if (shave.shaveStatus === "Failed") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>
          {shave.shaveStatus}
        </Badge>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="View work item"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}
    </div>
  );
};

const ShaveTable = ({ shaves }: { shaves: ShaveItem[] }) => {
  console.log(shaves);
  return (
    <Table className="min-w-[800px]">
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
              {(() => {
                const thumbnail = shave.videoEmbedUrl
                  ? getYouTubeThumbnail(shave.videoEmbedUrl)
                  : null;
                const videoUrl =
                  shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;
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
            <TableCell
              className="font-medium max-w-[400px] truncate"
              title={shave.title}
            >
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
  );
};

// TODO: Remove mock data after UI testing
const MOCK_SHAVES: ShaveItem[] = [
  // Completed with YouTube video, project, and work item
  {
    id: "1",
    title: "Filters Layout - Move dashboard filters from horizontal top bar to vertical side panel #13888",
    videoFile: { fileName: "recording-1.mp4", createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), duration: "5:32", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Completed",
    workItemType: "Bug",
    projectName: "TinaCMS",
    workItemUrl: "https://github.com/tinacms/tinacms/issues/13888",
    feedback: null,
    videoEmbedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  // Processing — no video yet, no project
  {
    id: "2",
    title: "Fix authentication timeout on mobile devices when using SSO",
    videoFile: { fileName: "recording-2.mp4", createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), duration: "2:15", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    shaveStatus: "Processing",
    workItemType: "Bug",
    projectName: "",
    workItemUrl: "",
    feedback: null,
    videoEmbedUrl: "",
  },
  // Failed — has video, has project, no work item URL
  {
    id: "3",
    title: "API rate limiting not working correctly for batch endpoints",
    videoFile: { fileName: "recording-3.mp4", createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), duration: "8:01", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Failed",
    workItemType: "Task",
    projectName: "SSW.Website",
    workItemUrl: "",
    feedback: "Transcription failed due to audio quality",
    videoEmbedUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
  },
  // Completed — no video URL, no project, has work item
  {
    id: "4",
    title: "Update README with new deployment instructions",
    videoFile: { fileName: "recording-4.mp4", createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), duration: "1:03", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Completed",
    workItemType: "Task",
    projectName: "",
    workItemUrl: "https://dev.azure.com/ssw/project/_workitems/edit/12345",
    feedback: null,
    videoEmbedUrl: "",
  },
  // Cancelled — has everything
  {
    id: "5",
    title: "Investigate memory leak in WebSocket connection handler causing server crashes under load",
    videoFile: { fileName: "recording-5.mp4", createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), duration: "12:45", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Cancelled",
    workItemType: "Bug",
    projectName: "SSW.Rules",
    workItemUrl: "https://github.com/SSWConsulting/SSW.Rules/issues/999",
    feedback: null,
    videoEmbedUrl: "https://www.youtube.com/embed/9bZkp7q19f0",
  },
  // Pending — just created, nothing yet
  {
    id: "6",
    title: "Add dark mode support to settings page",
    videoFile: { fileName: "recording-6.mp4", createdAt: new Date(Date.now() - 30 * 1000).toISOString(), duration: "0:45", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 30 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 1000).toISOString(),
    shaveStatus: "Pending",
    workItemType: "",
    projectName: "",
    workItemUrl: "",
    feedback: null,
    videoEmbedUrl: "",
  },
  // Completed — very long title, Chrome extension source, old date
  {
    id: "7",
    title: "🐛 Bug: When clicking the submit button multiple times rapidly on the contact form it creates duplicate entries in the database and sends multiple confirmation emails to the user which is very confusing",
    videoFile: { fileName: "chrome-recording.webm", createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), duration: "3:22", isChromeExtension: true },
    updatedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Completed",
    workItemType: "Bug",
    projectName: "Northwind",
    workItemUrl: "https://github.com/northwind/app/issues/42",
    feedback: "Great recording, very clear reproduction steps",
    videoEmbedUrl: "https://www.youtube.com/embed/LXb3EKWsInQ",
  },
  // Unknown status — edge case
  {
    id: "8",
    title: "Untitled shave",
    videoFile: { fileName: "recording-8.mp4", createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), duration: "0:10", isChromeExtension: false },
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    shaveStatus: "Unknown",
    workItemType: "",
    projectName: "",
    workItemUrl: "",
    feedback: null,
    videoEmbedUrl: "",
  },
];

const USE_MOCK_DATA = true; // Toggle to false to use real API data

export function HomePage() {
  const [shaves, setShaves] = useState<ShaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shaveDisplayMode, setShaveDisplayMode] = useState<"table" | "card">(
    "table",
  );

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      if (USE_MOCK_DATA) {
        setShaves(MOCK_SHAVES);
        setLoading(false);
        return;
      }
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
