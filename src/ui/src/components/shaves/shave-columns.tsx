import type { ColumnDef } from "@tanstack/react-table";
import { Video } from "lucide-react";
import { getYouTubeThumbnail, timeAgo } from "@/lib/utils";
import { SortableHeader } from "../ui/sortable-header";
import { Badge } from "../ui/badge";
import type { BadgeVariant, ShaveItem } from "../../types";
import { ShaveAction } from "./ShaveAction";

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

export const shaveColumns: ColumnDef<ShaveItem>[] = [
  {
    id: "video",
    header: "Video",
    size: 120,
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => {
      const shave = row.original;
      const thumbnail = shave.videoEmbedUrl ? getYouTubeThumbnail(shave.videoEmbedUrl) : null;
      const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;
      const Wrapper = videoUrl ? "a" : "div";
      return (
        <Wrapper
          className={`w-[100px] h-[56px] rounded bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden ${videoUrl ? "cursor-pointer" : "cursor-default opacity-50"}`}
          {...(videoUrl
            ? { href: videoUrl, target: "_blank", rel: "noopener noreferrer", title: "Open video" }
            : {})}
        >
          {thumbnail ? (
            <img src={thumbnail} alt={shave.title} className="w-full h-full object-cover" />
          ) : (
            <Video className="h-5 w-5 text-muted-foreground" />
          )}
        </Wrapper>
      );
    },
  },
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader column={column} label="Title" />,
    cell: ({ row }) => (
      <span className="font-medium max-w-[400px] truncate block" title={row.original.title}>
        {row.original.title}
      </span>
    ),
  },
  {
    id: "created",
    accessorFn: (row) => new Date(row.updatedAt || row.createdAt).getTime(),
    header: ({ column }) => <SortableHeader column={column} label="Created" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {timeAgo(new Date(row.original.updatedAt || row.original.createdAt))}
      </span>
    ),
  },
  {
    accessorKey: "projectName",
    header: ({ column }) => <SortableHeader column={column} label="Location" />,
    cell: ({ row }) => (
      <span
        className="text-muted-foreground max-w-[150px] truncate block"
        title={row.original.projectName || ""}
      >
        {row.original.projectName || "—"}
      </span>
    ),
  },
  {
    accessorKey: "shaveStatus",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={getStatusVariant(row.original.shaveStatus)}>{row.original.shaveStatus}</Badge>
    ),
    filterFn: (row, _columnId, filterValue) => {
      if (!filterValue || filterValue === "all") return true;
      return row.original.shaveStatus === filterValue;
    },
  },
  {
    id: "actions",
    size: 80,
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ row }) => <ShaveAction shave={row.original} />,
  },
];
