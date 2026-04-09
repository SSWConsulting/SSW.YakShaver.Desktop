import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Square,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Input } from "../components/ui/input";
import { ScrollArea, ScrollBar } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { ipcClient } from "../services/ipc-client";
import type { BadgeVariant, ShaveItem } from "../types";

const NO_SHAVES_STEPS: string[] = [
  "Record screen and describe the issue",
  "AI transcribes and analyzes content",
  "Receive a structured work item ready to send",
];

const ALL_STATUSES = ["Completed", "Processing", "Failed", "Cancelled", "Pending", "Unknown"];

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

const columns: ColumnDef<ShaveItem>[] = [
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
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Title
          {sorted === "asc" ? (
            <ArrowUp className="ml-1 h-3 w-3" />
          ) : sorted === "desc" ? (
            <ArrowDown className="ml-1 h-3 w-3" />
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3" />
          )}
        </Button>
      );
    },
    cell: ({ row }) => (
      <span className="font-medium max-w-[400px] truncate block" title={row.original.title}>
        {row.original.title}
      </span>
    ),
  },
  {
    id: "created",
    accessorFn: (row) => new Date(row.updatedAt || row.createdAt).getTime(),
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Created
          {sorted === "asc" ? (
            <ArrowUp className="ml-1 h-3 w-3" />
          ) : sorted === "desc" ? (
            <ArrowDown className="ml-1 h-3 w-3" />
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3" />
          )}
        </Button>
      );
    },
    cell: ({ row }) => (
      <span className="text-muted-foreground whitespace-nowrap">
        {timeAgo(new Date(row.original.updatedAt || row.original.createdAt))}
      </span>
    ),
  },
  {
    accessorKey: "projectName",
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Location
          {sorted === "asc" ? (
            <ArrowUp className="ml-1 h-3 w-3" />
          ) : sorted === "desc" ? (
            <ArrowDown className="ml-1 h-3 w-3" />
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3" />
          )}
        </Button>
      );
    },
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

const ShaveTableView = ({ table }: { table: ReturnType<typeof useReactTable<ShaveItem>> }) => {
  return (
    <Table className="min-w-[800px]">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
              No shaves match your filters.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
};

export function HomePage() {
  const [shaves, setShaves] = useState<ShaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shaveDisplayMode, setShaveDisplayMode] = useState<"table" | "card">("table");

  const [sorting, setSorting] = useState<SortingState>([{ id: "created", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const loadShaves = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcClient.portal.getMyShaves();
      const items = result.data?.items ?? [];
      setShaves(items);
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

  const projectNames = useMemo(() => {
    const names = new Set(shaves.map((s) => s.projectName).filter(Boolean));
    return Array.from(names).sort();
  }, [shaves]);

  const statusFilter = columnFilters.find((f) => f.id === "shaveStatus")?.value as
    | string
    | undefined;
  const projectFilter = columnFilters.find((f) => f.id === "projectName")?.value as
    | string
    | undefined;

  const hasActiveFilters = globalFilter || statusFilter || projectFilter;

  const clearFilters = () => {
    setGlobalFilter("");
    setColumnFilters([]);
    setSorting([{ id: "created", desc: true }]);
  };

  const table = useReactTable({
    data: shaves,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const search = (filterValue as string).toLowerCase();
      return (
        row.original.title.toLowerCase().includes(search) ||
        (row.original.projectName || "").toLowerCase().includes(search)
      );
    },
  });

  if (loading) {
    return (
      <div className="z-10 relative flex flex-col items-center p-8">
        <LoadingState />
      </div>
    );
  }

  const filteredRows = table.getRowModel().rows;

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

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search shaves..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter || "all"}
          onValueChange={(value) => {
            setColumnFilters((prev) => {
              const without = prev.filter((f) => f.id !== "shaveStatus");
              return value === "all" ? without : [...without, { id: "shaveStatus", value }];
            });
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ALL_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectNames.length > 0 && (
          <Select
            value={projectFilter || "all"}
            onValueChange={(value) => {
              setColumnFilters((prev) => {
                const without = prev.filter((f) => f.id !== "projectName");
                return value === "all" ? without : [...without, { id: "projectName", value }];
              });
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projectNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {shaves.length === 0 ? (
          <NoShaves />
        ) : shaveDisplayMode === "card" ? (
          filteredRows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No shaves match your filters.</p>
          ) : (
            <ShaveCards shaves={filteredRows.map((r) => r.original)} />
          )
        ) : (
          <ShaveTableView table={table} />
        )}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
