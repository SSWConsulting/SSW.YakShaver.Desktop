import { Video } from "lucide-react";
import { getYouTubeThumbnail } from "@/lib/utils";
import type { Shave } from "../../types";

interface VideoThumbnailProps {
  shave: Shave;
}

export function VideoThumbnail({ shave }: VideoThumbnailProps) {
  const thumbnail = shave.videoEmbedUrl
    ? getYouTubeThumbnail(shave.videoEmbedUrl)
    : null;
  const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;

  const content =
    thumbnail ? (
      <img
        src={thumbnail}
        alt={shave.title}
        className="w-full h-full object-cover"
      />
    ) : (
      <Video className="h-5 w-5 text-muted-foreground" />
    );

  if (videoUrl) {
    return (
      <a
        href={videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open video"
        className="w-[100px] h-[56px] rounded bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden cursor-pointer"
      >
        {content}
      </a>
    );
  }

  return (
    <div className="w-[100px] h-[56px] rounded bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden cursor-default opacity-50">
      {content}
    </div>
  );
}
