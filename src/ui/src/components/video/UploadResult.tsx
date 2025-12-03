import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClipboard } from "../../hooks/useClipboard";
import { UploadStatus, type VideoUploadResult } from "../../types";
import { Badge } from "../ui/badge";
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

type StatusVariant = "success" | "failed" | "external";

const STATUS_CONFIG = {
  success: { label: "Success", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  external: { label: "External", variant: "outline" },
} as const;
type StatusType = keyof typeof STATUS_CONFIG;

const StatusBadge = ({ status }: { status: StatusType }) => {
  const { label, variant } = STATUS_CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
};

const VideoCard = ({
  title = "YouTube Upload",
  subtitle,
  url,
  uploading = false,
  error,
  status = "success",
}: {
  title?: string;
  subtitle?: string;
  url: string | null;
  uploading?: boolean;
  error?: string;
  status?: StatusVariant;
}) => {
  const { copyToClipboard } = useClipboard();

  return (
    <Card className="w-full bg-black/20 backdrop-blur-sm border-white/10">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle && <CardDescription className="text-sm">{subtitle}</CardDescription>}
          </div>
          <div className="flex-shrink-0">
            {uploading ? <UploadingBadge /> : <StatusBadge status={status} />}
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
                className="cursor-pointer"
                onClick={() => copyToClipboard(url)}
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="cursor-pointer"
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
  if (!result) return null;

  // Show error state
  if (!result.success) {
    return <VideoCard title="Upload failed" url={null} status="failed" error={result.error} />;
  }

  if (!result.data) return null;

  // Show state immediately if the video is from an external source
  const isExternal = result.origin === "external";
  if (isExternal) {
    return (
      <VideoCard
        title="Watch Video"
        subtitle={result.data.title}
        url={result.data.url}
        status="external"
      />
    );
  }

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

  const descriptionSummary = summarizeDescription(result.data.description);

  return (
    <VideoCard
      title={result.data.title || "YouTube Upload"}
      subtitle={descriptionSummary}
      url={result.data.url}
      status="success"
    />
  );
};

export { VideoCard as VideoInfo };
