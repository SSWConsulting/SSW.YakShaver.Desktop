import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ipcClient } from "../services/ipc-client";
import { ProgressStage, type WorkflowProgress } from "../types";

export function useSaveShaveOnCompletion() {
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;
      console.log(`[Shave] Progress Event: ${progressData.stage}`, progressData);

      // Save shave when workflow is completed
      if (progressData.stage === ProgressStage.COMPLETED) {
        const { uploadResult, finalOutput } = progressData;
        const videoUrl = uploadResult?.data?.url;

        console.log("\n=== SHAVE CREATION START ===");
        console.log("[Shave] Final YouTube URL:", videoUrl);

        // Check for duplicates using the final YouTube link
        if (videoUrl && lastSavedRef.current === videoUrl) {
          console.log("[Shave] ⚠ Skipping duplicate save for YouTube URL:", videoUrl);
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

          console.log("[Shave] Creating shave with data:", JSON.stringify(shaveData, null, 2));

          const shave = await ipcClient.shave.create(shaveData);

          if (videoUrl) {
            lastSavedRef.current = videoUrl;
          }

          console.log("[Shave] ✓ Shave record created successfully!");
          console.log("[Shave] - Shave ID:", shave.id);
          console.log("[Shave] - Title:", shave.title);
          console.log("[Shave] - Video URL:", shave.videoEmbedUrl);
          console.log("[Shave] - Work Item URL:", shave.workItemUrl || "(none)");
          console.log("[Shave] - Status:", shave.shaveStatus);
          console.log("=== SHAVE CREATION END ===\n");
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
