import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import type { ScreenSource } from "../../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

type SourcePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sourceId: string) => void;
};

export function SourcePickerDialog({ open, onOpenChange, onSelect }: SourcePickerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<ScreenSource[]>([]);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipcClient.screenRecording.listSources();
      setSources(list);
    } catch {
      toast.error("Failed to fetch screen sources, please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchSources();
    } else {
      setSources([]);
      setLoading(false);
    }
  }, [open, fetchSources]);

  const screens = useMemo(() => sources.filter((s) => s.type === "screen"), [sources]);
  const windows = useMemo(() => sources.filter((s) => s.type === "window"), [sources]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl bg-neutral-900 text-neutral-100 border-neutral-800 p-4">
        <DialogHeader>
          <DialogTitle>Choose a source to record</DialogTitle>
          <DialogDescription>
            Select a screen or window to capture. Hover to preview and click to start recording.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-auto space-y-6 p-2">
          {loading && (
            <div className="text-sm text-neutral-400 text-center py-2">Loading sources…</div>
          )}
          <SourceSection label="Screens" sources={screens} onSelect={(id) => onSelect(id)} />
          <SourceSection label="Windows" sources={windows} onSelect={(id) => onSelect(id)} />

          {!loading && screens.length === 0 && windows.length === 0 && (
            <div className="text-sm text-neutral-400 text-center py-8">No sources available</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceSection({
  label,
  sources,
  onSelect,
}: {
  label: string;
  sources: ScreenSource[];
  onSelect: (id: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 gap-5">
        {sources.map((src) => (
          <ImageTile key={src.id} source={src} onClick={() => onSelect(src.id)} />
        ))}
      </div>
    </section>
  );
}

function ImageTile({ source, onClick }: { source: ScreenSource; onClick: () => void }) {
  const preview = source.thumbnailDataURL ?? source.appIconDataURL;
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={source.name}
      className="group relative block aspect-video w-full h-auto overflow-hidden rounded-lg bg-neutral-800 p-0 ring-offset-neutral-900 transition-all hover:ring-2 hover:ring-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 hover:bg-neutral-800"
    >
      {preview ? (
        <img src={preview} alt={source.name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-neutral-800" />
      )}
    </Button>
  );
}
