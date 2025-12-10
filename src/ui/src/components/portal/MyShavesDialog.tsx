import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipcClient } from "@/services/ipc-client";
import type { GetMyShavesResponse } from "@/types";

interface MyShavesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MyShavesDialog({ open, onOpenChange }: MyShavesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GetMyShavesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMyShaves = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await ipcClient.portal.getMyShaves();
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error || "Failed to fetch shaves");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load data when dialog opens
  useEffect(() => {
    if (open && !data && !loading) {
      fetchMyShaves();
    }
  }, [open, data, loading, fetchMyShaves]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>My Shaves</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button onClick={fetchMyShaves} disabled={loading} variant="outline">
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-md">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {data && (
            <ScrollArea className="h-[60vh] rounded-md border">
              <div className="p-4">
                <pre className="text-sm text-white whitespace-pre-wrap break-all">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            </ScrollArea>
          )}

          {!data && !error && !loading && (
            <div className="text-center text-white/60 py-8">
              <p>Click "Refresh" to load your shaves</p>
            </div>
          )}

          {loading && (
            <div className="text-center text-white/60 py-8">
              <p>Loading your shaves...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
