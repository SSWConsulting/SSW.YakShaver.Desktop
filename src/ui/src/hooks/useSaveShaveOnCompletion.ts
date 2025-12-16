import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ipcClient } from "../services/ipc-client";
import { ProgressStage, type WorkflowProgress } from "../types";

/**
 * Hook to automatically save shave records when video processing starts and update when completed
 */
export function useSaveShaveOnCompletion() {
  const lastSavedRef = useRef<string | null>(null);
  const currentShaveIdRef = useRef<number | null>(null);

  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;

      // Case 1 & 2: Create shave when recording finishes uploading OR when external video is downloaded
      const shouldCreateShave =
        (progressData.stage === ProgressStage.UPLOADING_SOURCE ||
          progressData.stage === ProgressStage.DOWNLOADING_SOURCE) &&
        progressData.uploadResult;

      if (shouldCreateShave && progressData.uploadResult) {
        const { uploadResult, metadataPreview } = progressData;
        const videoTitle = uploadResult.data?.title || metadataPreview?.title || "Unknown Video";
        const videoUrl = uploadResult.data?.url;
        const uploadKey = `${videoUrl || videoTitle || Date.now()}`;

        // Prevent duplicate saves for the same video
        if (lastSavedRef.current === uploadKey) {
          return;
        }

        try {
          const shave = await ipcClient.shave.create({
            workItemSource: "YakShaver Desktop",
            title: videoTitle,
            videoFile: {
              fileName: videoTitle,
              createdAt: new Date().toISOString(),
              duration: 0, // Will be updated when completed
            },
            shaveStatus: "processing",
            projectName: undefined,
            workItemUrl: undefined, // Will be updated when completed
          });

          currentShaveIdRef.current = shave.id;
          lastSavedRef.current = uploadKey;
          console.log(`Shave record created with ID: ${shave.id}`);
        } catch (error) {
          console.error("Failed to create shave record:", error);
          toast.error("Failed to save shave record");
        }
      }

      // Case 1 & 2: Update shave when entire process is completed
      if (progressData.stage === ProgressStage.COMPLETED && currentShaveIdRef.current) {
        try {
          const { uploadResult, metadataPreview, finalOutput } = progressData;

          // Extract GitHub issue URL from final output
          const githubIssueMatch = finalOutput?.match(
            /https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/,
          );
          const workItemUrl = githubIssueMatch?.[0];

          // Extract title from final output (first line or heading)
          let finalTitle: string | undefined;
          if (finalOutput) {
            const titleMatch = finalOutput.match(/^#\s+(.+)$/m) || finalOutput.match(/^(.+)$/m);
            finalTitle = titleMatch?.[1]?.trim();
          }

          const title =
            finalTitle || uploadResult?.data?.title || metadataPreview?.title || "Unknown Video";

          await ipcClient.shave.update(currentShaveIdRef.current, {
            title,
            shaveStatus: "completed",
            workItemUrl,
          });

          console.log(`Shave record updated with ID: ${currentShaveIdRef.current}`);
          currentShaveIdRef.current = null;
        } catch (error) {
          console.error("Failed to update shave record:", error);
          toast.error("Failed to update shave record");
        }
      }

      // Reset on error
      if (progressData.stage === ProgressStage.ERROR) {
        if (currentShaveIdRef.current) {
          try {
            await ipcClient.shave.updateStatus(currentShaveIdRef.current, "failed");
            console.log(`Shave record marked as failed: ${currentShaveIdRef.current}`);
          } catch (error) {
            console.error("Failed to update shave status to failed:", error);
          }
          currentShaveIdRef.current = null;
        }
      }
    });
  }, []);
}
