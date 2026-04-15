import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { LayoutGrid, List, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Heading } from "@/components/typography/heading-tag";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LoadingState } from "../components/common/LoadingState";
import { NoShaves } from "../components/shaves/NoShaves";
import { ShaveCards } from "../components/shaves/ShaveCards";
import { shaveColumns } from "../components/shaves/shave-columns";
import { DataTable } from "../components/data-table";
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
import { ShaveStatus, type ShaveItem } from "../types";

const ALL_STATUSES = Object.values(ShaveStatus);

export function HomePage() {
  const [shaves, setShaves] = useState<ShaveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shaveDisplayMode, setShaveDisplayMode] = useState<"table" | "card">("table");

  const [sorting, setSorting] = useState<SortingState>([{ id: "created", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const loadShaves = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipcClient.portal.getMyShaves();
      const items = result.data?.items ?? [];
      setShaves(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load shaves";
      setError(message);
      toast.error("Failed to load shaves");
      console.error(err);
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
    columns: shaveColumns,
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
        <Heading>My Shaves</Heading>
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

      {/* Search, Filter, Sort controls */}
      <div className="flex flex-col gap-3">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search shaves..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-row gap-3 items-center">
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
      </div>

      <ScrollArea className="flex-1">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <p className="text-muted-foreground">Something went wrong loading your shaves.</p>
            <Button variant="outline" onClick={loadShaves} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : shaves.length === 0 ? (
          <NoShaves />
        ) : shaveDisplayMode === "card" ? (
          filteredRows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No shaves match your filters.</p>
          ) : (
            <ShaveCards shaves={filteredRows.map((r) => r.original)} />
          )
        ) : (
          <DataTable
            table={table}
            columns={shaveColumns}
            emptyMessage="No shaves match your filters."
            className="min-w-[800px]"
          />
        )}
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
