import { ExternalLink, RefreshCw, Square } from "lucide-react";
import { Button } from "../ui/button";
import type { ShaveItem } from "../../types";

export function ShaveAction({ shave }: { shave: ShaveItem }) {
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
}
