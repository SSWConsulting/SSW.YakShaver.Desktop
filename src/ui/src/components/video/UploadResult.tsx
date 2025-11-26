import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClipboard } from "../../hooks/useClipboard";
import { UploadStatus, type VideoUploadResult } from "../../types";
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
  title = "YouTube Upload",
  subtitle,
  url,
  success = true,
  uploading = false,
  error,
}: {
  title?: string;
  subtitle?: string;
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
            <CardTitle className="text-base text-white">{title}</CardTitle>
            {subtitle && (
              <CardDescription className="text-sm text-white/60">{subtitle}</CardDescription>
            )}
          </div>
          <div className="flex-shrink-0">
            {uploading ? <UploadingBadge /> : <StatusBadge success={success} />}
          </div>
        </div>
        {error && (
          <p className="text-red-400 text-xs mt-2 border-l-2 border-red-500/50 pl-2">{error}</p>
        )}
      </CardHeader>
      {!uploading && (
        <CardContent>
          <div className="p-3 bg-white/5 rounded-md flex items-center justify-between border border-white/10">
            <p className="text-sm truncate flex-1 min-w-0">{url}</p>
            <div className="flex items-center gap-1 ml-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => copyToClipboard(url)}
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
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

const summarizeDescription = (description: string) => {
  if (!description) return "";
  const firstLine = description.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
};

export const UploadResult = ({
  result,
  status,
}: {
  result: VideoUploadResult | null;
  status: UploadStatus;
}) => {
  // Show uploading state
  if (status === UploadStatus.UPLOADING) {
    return (
      <VideoCard
        title="Uploading to YouTube"
        subtitle="Preparing your recording..."
        url={null}
        uploading={true}
      />
    );
  }

  if (!result) return null;

  // Show error state
  if (!result.success) {
    return <VideoCard title="Upload failed" url={null} success={false} error={result.error} />;
  }

  if (!result.data) return null;

  // Show success state
  return (
    <VideoCard
      title={result.data.title || "YouTube Upload"}
      subtitle={summarizeDescription(result.data.description)}
      url={result.data.url}
      success={true}
    />
  );
};

export { VideoCard as VideoInfo };
