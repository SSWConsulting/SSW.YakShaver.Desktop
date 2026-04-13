import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "./button";

interface SortableHeaderProps<TData> {
  column: Column<TData>;
  label: string;
}

export function SortableHeader<TData>({ column, label }: SortableHeaderProps<TData>) {
  const sorted = column.getIsSorted();
  return (
    <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 h-3 w-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 h-3 w-3" />
      ) : (
        <ArrowUpDown className="ml-1 h-3 w-3" />
      )}
    </Button>
  );
}
