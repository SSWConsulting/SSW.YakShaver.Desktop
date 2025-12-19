import { useEffect } from "react";
import { toast } from "sonner";
import { ipcClient } from "../services/ipc-client";
import type { WorkflowProgress } from "../types";

export function useSaveShaveOnCompletion() {
  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;

      // Save shave when there's final output
      if (typeof progressData.finalOutput !== "undefined") {
        const { uploadResult, finalOutput } = progressData;
        const videoUrl = uploadResult?.data?.url;

        // Check if this video URL already exists in the database
        if (videoUrl) {
          const existingShave = await ipcClient.shave.findByVideoUrl(videoUrl);
          if (existingShave) {
            return;
          }
        }

        try {
          // Parse final output
          let parsedOutput: {
            Title?: string;
            URL?: string;
            Status?: string;
          } = {};
          try {
            if (finalOutput) {
              const cleanOutput = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
              parsedOutput = JSON.parse(cleanOutput);
            }
          } catch (e) {
            console.warn("[Shave] Failed to parse finalOutput as JSON:", e);
          }

          const workItemUrl = parsedOutput.URL;
          const finalTitle =
            parsedOutput.Title || uploadResult?.data?.title || "Untitled Work Item";

          // Determine status
          let shaveStatus: "Completed" | "Failed" = "Completed";
          const statusStr = parsedOutput.Status;
          if (statusStr && statusStr.toLowerCase() === "failed") {
            shaveStatus = "Failed";
          }

          const shaveData = {
            workItemSource: "YakShaver Desktop",
            title: finalTitle,
            videoFile: {
              fileName: finalTitle,
              filePath: videoUrl,
              createdAt: new Date().toISOString(),
              duration: 0,
            },
            shaveStatus,
            projectName: undefined,
            workItemUrl,
            videoEmbedUrl: videoUrl,
          };

          await ipcClient.shave.create(shaveData);
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to create shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE CREATION END (FAILED) ===\n");
          toast.error("Failed to save shave record");
        }
      }
    });
  }, []);
}
