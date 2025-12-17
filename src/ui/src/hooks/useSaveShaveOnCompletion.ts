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
      console.log(`[Shave] Progress Event: ${progressData.stage}`, progressData);

      // Case 1 & 2: Create shave when when external video is uploaded OR finishes recording
      const shouldCreateShave =
        progressData.stage === ProgressStage.UPLOADING_SOURCE ||
        progressData.stage === ProgressStage.DOWNLOADING_SOURCE;
      if (shouldCreateShave) {
        const { uploadResult, metadataPreview, filePath } = progressData;
        const videoTitle = uploadResult?.data?.title || metadataPreview?.title || "Untitled Video";
        const videoUrl = uploadResult?.data?.url;
        const uploadKey = `${videoUrl || Date.now()}`;

        console.log("\n=== SHAVE CREATION START ===");
        console.log("[Shave] Progress stage:", progressData.stage);
        console.log("[Shave] Video title:", videoTitle);
        console.log("[Shave] Video URL (YouTube):", videoUrl);
        console.log("[Shave] Upload origin:", uploadResult?.origin);
        console.log("[Shave] File path:", filePath);

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
              filePath: filePath,
              createdAt: new Date().toISOString(),
              duration: 0, // need to be updated
            },
            shaveStatus: "Processing" as const,
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

      // Update shave after uploading youtube is finished
      if (progressData.stage === ProgressStage.UPLOAD_COMPLETED && currentShaveIdRef.current) {
        const { uploadResult } = progressData;
        const videoUrl = uploadResult?.data?.url;
        const videoTitle = uploadResult?.data?.title || "Untitled Video";

        if (videoUrl) {
          console.log("\n=== SHAVE UPDATE (UPLOAD COMPLETED) START ===");
          console.log("[Shave] Updating shave ID:", currentShaveIdRef.current);
          console.log("[Shave] New Video URL:", videoUrl);

          try {
            const currentShave = await ipcClient.shave.getById(currentShaveIdRef.current);
            if (currentShave) {
              const updatedVideoFile = {
                ...currentShave.videoFile,
                fileName: videoTitle,
                filePath: videoUrl,
              };

              await ipcClient.shave.update(currentShaveIdRef.current, {
                videoEmbedUrl: videoUrl,
                videoFile: updatedVideoFile,
              });
              console.log("[Shave] ✓ Shave record updated with video URL and metadata!");
            }
          } catch (error) {
            console.error("[Shave] ✗ Failed to update shave with video URL:", error);
          }
          console.log("=== SHAVE UPDATE (UPLOAD COMPLETED) END ===\n");
        }
      }

      // Case 1 & 2: Update shave when entire process is completed
      if (progressData.stage === ProgressStage.COMPLETED && currentShaveIdRef.current) {
        console.log("\n=== SHAVE UPDATE START ===");
        console.log("[Shave] Updating shave ID:", currentShaveIdRef.current);

        try {
          const { finalOutput } = progressData;

          let parsedOutput: {
            Title?: string;
            URL?: string;
            Status?: string;
          } = {};
          try {
            if (finalOutput) {
              // Handle potential markdown code blocks if the LLM wraps the JSON
              const cleanOutput = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
              parsedOutput = JSON.parse(cleanOutput);
            }
          } catch (e) {
            console.warn("[Shave] Failed to parse finalOutput as JSON:", e);
          }

          const workItemUrl = parsedOutput.URL;
          const finalTitle = parsedOutput.Title;

          // Determine status
          let shaveStatus: "Completed" | "Failed" = "Completed";
          const statusStr = parsedOutput.Status;
          if (statusStr && statusStr.toLowerCase() === "failed") {
            shaveStatus = "Failed";
          }

          console.log("[Shave] Update data:");
          console.log("[Shave] - Title:", finalTitle);
          console.log("[Shave] - Work Item URL:", workItemUrl || "(none)");
          console.log("[Shave] - Status:", shaveStatus);

          await ipcClient.shave.update(currentShaveIdRef.current, {
            title: finalTitle,
            shaveStatus,
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
      if (progressData.stage === ProgressStage.ERROR) {
        console.log(
          "[Shave] Workflow error occurred. Full data:",
          JSON.stringify(progressData, null, 2),
        );
        if (currentShaveIdRef.current) {
          try {
            await ipcClient.shave.updateStatus(currentShaveIdRef.current, "Failed");
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
