import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ipcClient } from "../services/ipc-client";
import { ProgressStage, type WorkflowProgress } from "../types";

export function useSaveShaveOnCompletion() {
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;

      // Save shave when workflow is completed
      if (progressData.stage === ProgressStage.COMPLETED) {
        const { uploadResult, finalOutput } = progressData;
        const videoUrl = uploadResult?.data?.url;

        // Check for duplicates using the final YouTube link
        if (videoUrl && lastSavedRef.current === videoUrl) {
          return;
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

          if (videoUrl) {
            lastSavedRef.current = videoUrl;
          }
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to create shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE CREATION END (FAILED) ===\n");
          toast.error("Failed to save shave record");
        }
      }

      // Reset on error
      if (progressData.stage === ProgressStage.ERROR) {
        console.log(
          "[Shave] Workflow error occurred. Full data:",
          JSON.stringify(progressData, null, 2),
        );
      }
    });
  }, []);
}
