import { useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  videoUrl: string;
  videoBlob: Blob;
  onDurationLoad?: (duration: number) => void;
}

export function VideoPlayer({ videoUrl, videoBlob, onDurationLoad }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<string>("");
  const [fileSize, setFileSize] = useState<string>("");

  useEffect(() => {
    const sizeMB = (videoBlob.size / 1024 / 1024).toFixed(2);
    setFileSize(`${sizeMB} MB`);
  }, [videoBlob]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      const minutes = Math.floor(dur / 60);
      const seconds = Math.floor(dur % 60);
      setDuration(`${minutes}:${seconds.toString().padStart(2, "0")}`);
      onDurationLoad?.(Math.floor(dur));
    }
  };

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
          <track kind="captions" srcLang="en" label="English" />
        </video>
      </div>
      <div className="flex justify-between text-sm text-white/60">
        <span>Duration: {duration || "Loading..."}</span>
        <span>Size: {fileSize}</span>
      </div>
    </div>
  );
}
