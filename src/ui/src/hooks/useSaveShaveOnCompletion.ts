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

      // Case 1 & 2: Create shave when recording finishes uploading OR when external video is uploaded
      const shouldCreateShave =
        ((progressData.stage === ProgressStage.UPLOADING_SOURCE &&
          progressData.uploadResult?.origin === "external") ||
          progressData.stage === ProgressStage.DOWNLOADING_SOURCE) &&
        progressData.uploadResult;

      if (shouldCreateShave && progressData.uploadResult) {
        const { uploadResult, metadataPreview } = progressData;
        const videoTitle = uploadResult.data?.title || metadataPreview?.title || "Unknown Video";
        const videoUrl = uploadResult.data?.url;
        const uploadKey = `${videoUrl || videoTitle || Date.now()}`;

        console.log("\n=== SHAVE CREATION START ===");
        console.log("[Shave] Progress stage:", progressData.stage);
        console.log("[Shave] Video title:", videoTitle);
        console.log("[Shave] Video URL (YouTube):", videoUrl);
        console.log("[Shave] Upload origin:", uploadResult.origin);

        // Prevent duplicate saves for the same video
        if (lastSavedRef.current === uploadKey) {
          console.log("[Shave] ⚠ Skipping duplicate save for:", uploadKey);
          return;
        }

        try {
          const shaveData = {
            workItemSource: "YakShaver Desktop",
            title: videoTitle,
            videoFile: {
              fileName: videoTitle,
              createdAt: new Date().toISOString(),
              duration: 0, // Will be updated when completed
            },
            shaveStatus: "processing" as const,
            projectName: undefined,
            workItemUrl: undefined, // Will be updated when completed
            videoEmbedUrl: videoUrl, // Store YouTube URL
          };

          console.log("[Shave] Creating shave with data:", JSON.stringify(shaveData, null, 2));

          const shave = await ipcClient.shave.create(shaveData);

          currentShaveIdRef.current = shave.id;
          lastSavedRef.current = uploadKey;

          console.log("[Shave] ✓ Shave record created successfully!");
          console.log("[Shave] - Shave ID:", shave.id);
          console.log("[Shave] - Title:", shave.title);
          console.log("[Shave] - Video Embed URL:", shave.videoEmbedUrl);
          console.log("[Shave] - Status:", shave.shaveStatus);
          console.log("=== SHAVE CREATION END ===\n");
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to create shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE CREATION END (FAILED) ===\n");
          toast.error("Failed to save shave record");
        }
      }

      // Case 1 & 2: Update shave when entire process is completed
      if (progressData.stage === "completed" && currentShaveIdRef.current) {
        console.log("\n=== SHAVE UPDATE START ===");
        console.log("[Shave] Updating shave ID:", currentShaveIdRef.current);

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

          console.log("[Shave] Update data:");
          console.log("[Shave] - Title:", title);
          console.log("[Shave] - Work Item URL:", workItemUrl || "(none)");
          console.log("[Shave] - Status: completed");

          await ipcClient.shave.update(currentShaveIdRef.current, {
            title,
            shaveStatus: "completed",
            workItemUrl,
          });

          console.log("[Shave] ✓ Shave record updated successfully!");
          console.log("=== SHAVE UPDATE END ===\n");
          currentShaveIdRef.current = null;
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to update shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE UPDATE END (FAILED) ===\n");
          toast.error("Failed to update shave record");
        }
      }

      // Reset on error
      if (progressData.stage === "error") {
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
