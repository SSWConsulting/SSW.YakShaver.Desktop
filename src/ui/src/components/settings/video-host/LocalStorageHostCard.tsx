import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { useYouTubeAuth } from "../../../contexts/YouTubeAuthContext";
import { AuthStatus } from "../../../types";
import { PlatformConnectionCard } from "../../auth/PlatformConnectionCard";

interface LocalStorageHostCardProps {
  buttonSize?: "default" | "sm" | "lg" | "icon";
}

/**
 * #1062: local storage is the default video host — always available, used whenever no video
 * platform is connected. Shows where recordings and transcripts are kept.
 */
export function LocalStorageHostCard({ buttonSize = "lg" }: LocalStorageHostCardProps) {
  const { authState } = useYouTubeAuth();
  const [folder, setFolder] = useState<string>();

  const isInUse = authState.status !== AuthStatus.AUTHENTICATED;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await ipcClient.app.getLocalVideoDir();
        if (!cancelled && result.success) setFolder(result.data);
      } catch (error) {
        // The card still works without the path; the folder can be opened either way.
        console.warn("Failed to load the local recordings folder:", formatErrorMessage(error));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenFolder = async () => {
    try {
      const result = await ipcClient.app.openLocalVideoFolder();
      if (!result.success) throw new Error(result.error);
    } catch (error) {
      toast.error(`Failed to open folder: ${formatErrorMessage(error)}`);
    }
  };

  return (
    <PlatformConnectionCard
      icon={<HardDrive className="size-10 text-white/80" aria-hidden="true" />}
      title="Local storage"
      subtitle={folder}
      description={
        isInUse
          ? "Default. Recordings and transcripts are saved on this computer."
          : "Used when no video platform is connected."
      }
      badgeText={isInUse ? "In use" : undefined}
      onAction={handleOpenFolder}
      actionLabel="Open folder"
      buttonVariant="outline"
      buttonSize={buttonSize}
    />
  );
}
