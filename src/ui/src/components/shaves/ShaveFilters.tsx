import type { ColumnFiltersState } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ShaveStatus } from "../../types";

const ALL_STATUSES = Object.values(ShaveStatus);

interface ShaveFiltersProps {
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  statusFilter: string | undefined;
  projectFilter: string | undefined;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  projectNames: string[];
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

export function ShaveFilters({
  globalFilter,
  setGlobalFilter,
  statusFilter,
  projectFilter,
  setColumnFilters,
  projectNames,
  hasActiveFilters,
  clearFilters,
}: ShaveFiltersProps) {
  return (
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
  );
}
