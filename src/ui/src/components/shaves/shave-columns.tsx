import type { ColumnDef } from "@tanstack/react-table";
import { getStatusVariant } from "@/lib/shave-utils";
import { timeAgo } from "@/lib/utils";
import type { Shave } from "../../types";
import { Badge } from "../ui/badge";
import { SortableHeader } from "../ui/sortable-header";
import { ShaveAction } from "./ShaveAction";
import { VideoThumbnail } from "./VideoThumbnail";

export function createShaveColumns(): ColumnDef<Shave>[] {
  return [
    {
      id: "video",
      header: "Video",
      size: 120,
      enableSorting: false,
      enableColumnFilter: false,
      cell: ({ row }) => <VideoThumbnail shave={row.original} />,
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
      id: "lastUpdated",
      accessorFn: (row) => new Date(row.updatedAt || row.createdAt).getTime(),
      header: ({ column }) => <SortableHeader column={column} label="Last Updated" />,
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
        <Badge variant={getStatusVariant(row.original.shaveStatus)}>
          {row.original.shaveStatus}
        </Badge>
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
}
