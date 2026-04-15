import { Video } from "lucide-react";
import { getStatusVariant } from "@/lib/shave-utils";
import { getYouTubeThumbnail, timeAgo } from "@/lib/utils";
import type { ShaveItem } from "../../types";
import { Badge } from "../ui/badge";
import { ShaveAction } from "./ShaveAction";

function ShaveCardFooter({ shave }: { shave: ShaveItem }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {shave.projectName ? <Badge variant="outline">{shave.projectName}</Badge> : <span />}
        <span className="text-sm text-muted-foreground">
          {timeAgo(new Date(shave.updatedAt || shave.createdAt))}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
        <ShaveAction shave={shave} />
      </div>
    </div>
  );
}

function ShaveCard({ shave }: { shave: ShaveItem }) {
  const thumbnail = shave.videoEmbedUrl ? getYouTubeThumbnail(shave.videoEmbedUrl) : null;
  const videoUrl = shave.videoEmbedUrl?.replace("embed/", "watch?v=") || null;

  return (
    <div className="border border-white/20 rounded-lg overflow-hidden bg-black/30 backdrop-blur-sm flex flex-col h-full">
      {videoUrl ? (
        <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block">
          <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
            {thumbnail ? (
              <img src={thumbnail} alt={shave.title} className="w-full h-full object-cover" />
            ) : (
              <Video className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
        </a>
      ) : (
        <div className="w-full aspect-video bg-black/40 flex items-center justify-center">
          <Video className="h-8 w-8 text-muted-foreground" />
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <h3 className="font-medium text-sm line-clamp-2" title={shave.title}>
          {shave.title}
        </h3>
      </div>
      <div className="px-4 pb-3 mt-auto">
        <ShaveCardFooter shave={shave} />
      </div>
    </div>
  );
}

export function ShaveCards({ shaves }: { shaves: ShaveItem[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {shaves.map((shave) => (
        <ShaveCard key={shave.id} shave={shave} />
      ))}
    </div>
  );
}
