import { useEffect } from "react";
import { toast } from "sonner";
import { ipcClient } from "../services/ipc-client";
import { ShaveStatus, type WorkflowProgress } from "../types";

interface FinalOutput {
  Status?: string;
  Repository?: string;
  Title?: string;
  URL?: string;
  Description?: string;
  Labels?: string[];
}

interface ParsedShaveOutput {
  status: string;
  title: string;
  workItemUrl: string;
}

function parseFinalOutput(finalOutput: string): ParsedShaveOutput {
  const emptyOutput: ParsedShaveOutput = {
    status: "",
    title: "",
    workItemUrl: "",
  };

  if (!finalOutput) {
    return emptyOutput;
  }

  try {
    const cleanOutput = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
    const llmOutput: FinalOutput = JSON.parse(cleanOutput);

    return {
      status:
        llmOutput.Status?.toLowerCase() === "fail" ? ShaveStatus.Failed : ShaveStatus.Completed,
      title: llmOutput.Title || "",
      workItemUrl: llmOutput.URL || "",
    };
  } catch (e) {
    console.error("[Shave] Failed to parse finalOutput as JSON:", e);
    throw new Error(
      `Invalid shave output format: Unable to parse LLM response. This prevents saving the shave record. ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function useSaveShaveOnCompletion() {
  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;

      // Save shave when there's final output
      if (typeof progressData.finalOutput !== "undefined") {
        const { uploadResult, finalOutput } = progressData;
        const videoUrl = uploadResult?.data?.url;

        try {
          const parsedOutput = parseFinalOutput(finalOutput);
          const finalTitle =
            parsedOutput.title || uploadResult?.data?.title || "Untitled Work Item";
          const shaveStatus = (parsedOutput.status as ShaveStatus) || ShaveStatus.Completed;

          // Check if this video URL already exists in the database
          if (videoUrl) {
            const existingShave = await ipcClient.shave.findByVideoUrl(videoUrl);
            if (existingShave) {
              await ipcClient.shave.update(existingShave.id, {
                title: finalTitle,
                shaveStatus,
                workItemUrl: parsedOutput.workItemUrl,
              });
              toast.success("Shave updated", {
                description: "The work item has been updated in My Shaves with the new PBI.",
              });
              return;
            }
          }

          const shaveData = {
            workItemSource: "YakShaver Desktop",
            title: finalTitle,
            videoFile: null,
            shaveStatus,
            projectName: null,
            workItemUrl: parsedOutput.workItemUrl,
            videoEmbedUrl: videoUrl,
          };

          await ipcClient.shave.create(shaveData);
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to save/update shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE SAVE END (FAILED) ===\n");
          toast.error("Failed to save shave record");
        }
      }
    });
  }, []);
}
