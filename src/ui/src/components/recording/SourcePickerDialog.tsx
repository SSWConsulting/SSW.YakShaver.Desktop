import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CAMERA_ONLY_SOURCE_ID } from "../../constants/recording";
import { ipcClient } from "../../services/ipc-client";
import type { ScreenSource } from "../../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type SourcePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sourceId: string, devices: { cameraId?: string; microphoneId?: string }) => void;
};

export function SourcePickerDialog({ open, onOpenChange, onSelect }: SourcePickerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(undefined);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | undefined>(undefined);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  const stopCameraPreviewStream = useCallback(() => {
    const stream = cameraPreviewStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      cameraPreviewStreamRef.current = null;
    }
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = null;
    }
  }, []);
  const [devicesReady, setDevicesReady] = useState(false);
  const NO_CAMERA_VALUE = "__none__";
  const LAST_CAMERA_KEY = "yakshaver.lastCameraDeviceId";
  const LAST_MICROPHONE_KEY = "yakshaver.lastMicDeviceId";
  const NO_DEVICE_STORAGE_VALUE = "none";

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

  const fetchDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const mics = devices.filter((d) => d.kind === "audioinput");
      setCameraDevices(cams);
      setMicrophoneDevices(mics);
      const lastCam = localStorage.getItem(LAST_CAMERA_KEY) || undefined;
      const lastMic = localStorage.getItem(LAST_MICROPHONE_KEY) || undefined;
      if (lastCam === NO_DEVICE_STORAGE_VALUE) {
        setSelectedCameraId(undefined);
      } else {
        setSelectedCameraId(
          cams.find((c) => c.deviceId === lastCam)?.deviceId || cams[0]?.deviceId,
        );
      }
      setSelectedMicrophoneId(
        mics.find((m) => m.deviceId === lastMic)?.deviceId || mics[0]?.deviceId,
      );
      setDevicesReady(true);
    } catch {
      setCameraDevices([]);
      setMicrophoneDevices([]);
      setDevicesReady(true);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchSources();
      void fetchDevices();

      const handleDeviceChange = () => {
        void fetchDevices();
      };

      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      };
    }

    setSources([]);
    setLoading(false);
    setCameraDevices([]);
    setMicrophoneDevices([]);
    setDevicesReady(false);
    stopCameraPreviewStream();
  }, [open, fetchSources, fetchDevices, stopCameraPreviewStream]);

  useEffect(() => {
    const startPreview = async () => {
      if (!open || !devicesReady) return;
      if (!selectedCameraId || !cameraPreviewRef.current) {
        stopCameraPreviewStream();
        return;
      }
      stopCameraPreviewStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedCameraId } },
          audio: false,
        });
        cameraPreviewStreamRef.current = stream;
        const cameraPreviewVideo = cameraPreviewRef.current;
        if (!cameraPreviewVideo) return;
        cameraPreviewVideo.muted = true;
        cameraPreviewVideo.playsInline = true;
        await new Promise<void>((resolve) => {
          const handler = () => {
            cameraPreviewVideo.removeEventListener("loadedmetadata", handler);
            resolve();
          };
          cameraPreviewVideo.addEventListener("loadedmetadata", handler);
          cameraPreviewVideo.srcObject = stream;
        });
        await cameraPreviewVideo.play().catch(() => {});
      } catch {
        stopCameraPreviewStream();
      }
    };
    void startPreview();
  }, [open, selectedCameraId, devicesReady, stopCameraPreviewStream]);

  const screens = useMemo(() => sources.filter((s) => s.type === "screen"), [sources]);
  // const windows = useMemo(() => sources.filter((s) => s.type === "window"), [sources]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-4">
        <DialogHeader>
          <DialogTitle>Choose a source to record</DialogTitle>
          <DialogDescription>
            Select a screen to capture. Hover to preview and click to start recording.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-auto space-y-6 p-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Camera
              </span>
              <Select
                value={selectedCameraId ?? NO_CAMERA_VALUE}
                onValueChange={(value) => {
                  if (value === NO_CAMERA_VALUE) {
                    setSelectedCameraId(undefined);
                    localStorage.setItem(LAST_CAMERA_KEY, NO_DEVICE_STORAGE_VALUE);
                  } else {
                    setSelectedCameraId(value || undefined);
                    if (value) localStorage.setItem(LAST_CAMERA_KEY, value);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CAMERA_VALUE} textValue="No camera">
                    No camera
                  </SelectItem>
                  {cameraDevices.map((d) => (
                    <SelectItem
                      key={d.deviceId}
                      value={d.deviceId}
                      textValue={d.label || d.deviceId}
                    >
                      {d.label || d.deviceId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Microphone
              </span>
              <Select
                value={selectedMicrophoneId ?? ""}
                onValueChange={(v) => {
                  setSelectedMicrophoneId(v || undefined);
                  if (v) localStorage.setItem(LAST_MICROPHONE_KEY, v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent>
                  {microphoneDevices.map((d) => (
                    <SelectItem
                      key={d.deviceId}
                      value={d.deviceId}
                      textValue={d.label || d.deviceId}
                    >
                      {d.label || d.deviceId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedCameraId && (
            <div className="rounded-md overflow-hidden bg-neutral-800">
              <div className="relative aspect-video w-full">
                <video
                  ref={cameraPreviewRef}
                  className="h-full w-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />
              </div>
            </div>
          )}
          {loading && (
            <div className="text-sm text-muted-foreground text-center py-2">Loading sources…</div>
          )}
          
          {selectedCameraId && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Camera Only
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 gap-5">
                <CameraOnlyTile
                  onClick={() =>
                    onSelect(CAMERA_ONLY_SOURCE_ID, {
                      cameraId: selectedCameraId,
                      microphoneId: selectedMicrophoneId,
                    })
                  }
                />
              </div>
            </section>
          )}
          
          <SourceSection
            label="Screens"
            sources={screens}
            onSelect={(id) =>
              onSelect(id, {
                cameraId: selectedCameraId,
                microphoneId: selectedMicrophoneId,
              })
            }
          />

          {/**
           * As per conversation with Calum, we'll be hiding this feature temporarily
           * See GitHub issue: https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/287
           * <SourceSection
           *   label="Windows"
           *   sources={windows}
           *   onSelect={(id) => onSelect(id, { cameraId: selectedCameraId, microphoneId: selectedMicrophoneId })}
           * />
           */}

          {!loading && screens.length === 0 && !selectedCameraId && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No screens available
            </div>
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

  const handleClick = async () => {
    // Only minimize if we're not recording the main app window itself
    if (!source.isMainWindow) {
      await window.electronAPI.screenRecording.minimizeMainWindow();
    }

    onClick();
  };

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
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

function CameraOnlyTile({ onClick }: { onClick: () => void }) {
  const handleClick = async () => {
    await window.electronAPI.screenRecording.minimizeMainWindow();
    onClick();
  };

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      title="Camera Only - No Screen"
      className="group relative block aspect-video w-full h-auto overflow-hidden rounded-lg bg-neutral-800 p-4 ring-offset-neutral-900 transition-all hover:ring-2 hover:ring-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 hover:bg-neutral-800"
    >
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-neutral-400">
        {/* Icon: Crossed-out pin/thumbtack representing "no screen attachment" */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 10-4 4 6.5 6.5a2.828 2.828 0 1 0 4-4L15 10Z" />
          <path d="M14.5 15.5 9 21" />
          <path d="m2.5 2.5 19 19" />
          <path d="M8.707 8.707 3 14.5a2.828 2.828 0 1 0 4 4l5.793-5.793" />
        </svg>
        <span className="text-sm font-medium">No Screen / Camera Only</span>
        <span className="text-xs text-neutral-500">Record camera feed without screen capture</span>
      </div>
    </Button>
  );
}
