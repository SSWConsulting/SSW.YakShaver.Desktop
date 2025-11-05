import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useClipboard } from "../../hooks/useClipboard";
import type { UploadStatus, VideoUploadResult } from "../../types";
import { Button } from "../ui/button";

const openUrl = (url: string | null) => {
  if (url) {
    window.open(url, "_blank");
  } else {
    toast.error("Invalid URL");
  }
};

const UploadingBadge = () => (
  <span className="text-sm font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/80 border border-white/20 flex items-center gap-2">
    <Loader2 className="w-3 h-3 animate-spin" />
    Uploading
  </span>
);

const StatusBadge = ({ success }: { success: boolean }) => (
  <span
    className={`text-sm font-medium px-3 py-1.5 rounded-full ${
      success
        ? "bg-green-500/20 text-green-400 border border-green-500/30"
        : "bg-red-500/20 text-red-400 border border-red-500/30"
    }`}
  >
    {success ? "Success" : "Failed"}
  </span>
);

const VideoCard = ({
  description,
  url,
  success = true,
  uploading = false,
  error,
}: {
  description: string;
  url: string | null;
  success?: boolean;
  uploading?: boolean;
  error?: string;
}) => {
  const { copyToClipboard } = useClipboard();

  return (
    <Card className="w-full bg-black/20 backdrop-blur-sm border-white/10">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base text-white">
              YouTube Upload
            </CardTitle>
            <CardDescription className="text-sm text-white/60">
              {description}
            </CardDescription>
          </div>
          <div className="flex-shrink-0">
            {uploading ? <UploadingBadge /> : <StatusBadge success={success} />}
          </div>
        </div>
        {error && (
          <p className="text-red-400 text-xs mt-2 border-l-2 border-red-500/50 pl-2">
            {error}
          </p>
        )}
      </CardHeader>
      {!uploading && (
        <CardContent>
          <div className="p-3 bg-white/5 rounded-md flex items-center justify-between border border-white/10">
            <p className="text-sm text-white truncate flex-1 min-w-0">{url}</p>
            <div className="flex items-center gap-1 ml-2">
              <Button
                type="button"
                className="text-white/60 hover:text-white p-2 rounded transition-colors duration-200 hover:bg-white/10"
                onClick={() => copyToClipboard(url)}
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                className="text-white/60 hover:text-white p-2 rounded transition-colors duration-200 hover:bg-white/10"
                onClick={() => openUrl(url)}
                title="Open in YouTube"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export const UploadResult = ({
  result,
  status,
}: {
  result: VideoUploadResult | null;
  status: UploadStatus;
}) => {
  // Show uploading state
  if (status === "uploading") {
    return (
      <VideoCard
        description="Uploading video to YouTube..."
        url={null}
        uploading={true}
      />
    );
  }

  if (!result) return null;

  // Show error state
  if (!result.success) {
    return (
      <VideoCard
        description="Upload failed"
        url={null}
        success={false}
        error={result.error}
      />
    );
  }

  if (!result.data) return null;

  // Show success state
  return (
    <VideoCard
      description={result.data.description}
      url={result.data.url}
      success={true}
    />
  );
};

export { VideoCard as VideoInfo };
