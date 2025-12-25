import { useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  videoUrl: string;
  videoBlob: Blob;
  duration?: number; // Duration in seconds (optional, calculated from blob if not provided)
}

export function VideoPlayer({ videoUrl, videoBlob, duration }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [displayDuration, setDisplayDuration] = useState<string>("");
  const [fileSize, setFileSize] = useState<string>("");

  useEffect(() => {
    const sizeMB = (videoBlob.size / 1024 / 1024).toFixed(2);
    setFileSize(`${sizeMB} MB`);
  }, [videoBlob]);

  // Use provided duration if available, otherwise calculate from video element
  const handleLoadedMetadata = () => {
    if (duration !== undefined) {
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      setDisplayDuration(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    } else if (videoRef.current) {
      const dur = videoRef.current.duration;
      const minutes = Math.floor(dur / 60);
      const seconds = Math.floor(dur % 60);
      setDisplayDuration(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }
  };

  useEffect(() => {
    // If duration prop is provided, format it immediately without waiting for video load
    if (duration !== undefined) {
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      setDisplayDuration(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }
  }, [duration]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          className="w-full max-h-[500px]"
          onLoadedMetadata={handleLoadedMetadata}
        >
          <track kind="captions" srcLang="en" label="English Captions" />
        </video>
      </div>
      <div className="flex justify-between text-sm text-white/60">
        <span>Duration: {displayDuration || "Loading..."}</span>
        <span>Size: {fileSize}</span>
      </div>
    </div>
  );
}
