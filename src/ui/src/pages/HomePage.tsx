import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { LayoutGrid, List, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Heading } from "@/components/typography/heading-tag";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LoadingState } from "../components/common/LoadingState";
import { DataTable } from "../components/data-table";
import { HomeMcpStatusBanner } from "../components/home/HomeMcpStatusBanner";
import { NoShaves } from "../components/shaves/NoShaves";
import { ShaveCards } from "../components/shaves/ShaveCards";
import { ShaveFilters } from "../components/shaves/ShaveFilters";
import { createShaveColumns } from "../components/shaves/shave-columns";
import { Button } from "../components/ui/button";
import { ScrollArea, ScrollBar } from "../components/ui/scroll-area";
import { ipcClient } from "../services/ipc-client";
import type { Shave } from "../types";
import { parseWorkflowProgressNeoPayload } from "../utils";

interface LoadShavesOptions {
  showLoadingState?: boolean;
}

export function HomePage() {
  const [shaves, setShaves] = useState<Shave[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shaveDisplayMode, setShaveDisplayMode] = useState<"table" | "card">("table");
  const nextLoadRequestIdRef = useRef(0);
  const latestAppliedLoadRequestIdRef = useRef(0);

  const [sorting, setSorting] = useState<SortingState>([{ id: "updated", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const loadShaves = useCallback(async (options?: LoadShavesOptions) => {
    const showLoadingState = options?.showLoadingState ?? true;
    const requestId = nextLoadRequestIdRef.current + 1;
    nextLoadRequestIdRef.current = requestId;

    if (showLoadingState) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await ipcClient.shave.getAll();

      if (!result.success) {
        if (showLoadingState && requestId >= latestAppliedLoadRequestIdRef.current) {
          setError(result.error || "Failed to load shaves");
          toast.error(result.error || "Failed to load shaves");
        }
        return;
      }

      if (requestId < latestAppliedLoadRequestIdRef.current) {
        return;
      }

      latestAppliedLoadRequestIdRef.current = requestId;
      setShaves(result.data ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load shaves";
      if (showLoadingState && requestId >= latestAppliedLoadRequestIdRef.current) {
        setError(message);
        toast.error("Failed to load shaves");
      }
      console.error(err);
    } finally {
      if (showLoadingState) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadShaves();
  }, [loadShaves]);

  // #591: MyShaves previously only fetched the shave list once on mount, so a shave
  // that finished processing while this page was open (or already loaded) never
  // showed its updated status/results until a manual refresh. useShaveManager
  // (mounted once in App.tsx) persists the processing/completed/failed status to the
  // DB as workflow.onProgressNeo events arrive, but nothing told this page's list to
  // re-fetch. Subscribe here too and silently re-fetch (no loading skeleton) on every
  // progress event so the list picks up the persisted change as soon as it lands.
  useEffect(() => {
    return ipcClient.workflow.onProgressNeo((data: unknown) => {
      const { shaveId } = parseWorkflowProgressNeoPayload(data);
      if (!shaveId) {
        return;
      }
      void loadShaves({ showLoadingState: false });
    });
  }, [loadShaves]);

  const projectNames = useMemo(() => {
    const names = new Set(shaves.map((s) => s.projectName).filter((n): n is string => n !== null));
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
    setSorting([{ id: "lastUpdated", desc: true }]);
  };

  const shaveColumns = useMemo(() => createShaveColumns(), []);

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

        {shaves.length > 0 && (
          <ToggleGroup
            className="p-1 border border-white/20 rounded-md"
            type="single"
            value={shaveDisplayMode}
            onValueChange={(v: string) => v && setShaveDisplayMode(v as "table" | "card")}
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
        )}
      </div>

      <HomeMcpStatusBanner />

      {shaves.length > 0 && (
        <ShaveFilters
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          statusFilter={statusFilter}
          projectFilter={projectFilter}
          setColumnFilters={setColumnFilters}
          projectNames={projectNames}
          hasActiveFilters={Boolean(hasActiveFilters)}
          clearFilters={clearFilters}
        />
      )}

      <ScrollArea className="flex-1">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <p className="text-muted-foreground">Something went wrong loading your shaves.</p>
            <Button variant="outline" onClick={() => void loadShaves()} className="gap-2">
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
