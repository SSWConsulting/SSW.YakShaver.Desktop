import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { NewShave, NewVideoFile } from "../../../backend/db/schema";
import { normalizeYouTubeUrl } from "../../../backend/utils/youtube-url-utils";
import { ipcClient } from "../services/ipc-client";
import { ShaveStatus, type WorkflowProgress } from "../types";

//todo: check youtube url with shaveid
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

export function useShaveManager() {
  /**
   * Check if a video URL already has a shave in the database.
   */
  const checkExistingShave = useCallback(async (videoUrl: string): Promise<number | null> => {
    if (!videoUrl) return null;

    try {
      // Normalize the URL (especially for YouTube links)
      const normalizedUrl = normalizeYouTubeUrl(videoUrl);
      console.log("[Shave] Checking existing shave for URL:", normalizedUrl);
      if (!normalizedUrl) return null;

      // Check if a shave exists with this URL
      const result = await ipcClient.shave.findByVideoUrl(normalizedUrl);

      if (result.success && result.data) {
        console.log(`[Shave] Found existing shave (ID: ${result.data.id}) for URL:`, normalizedUrl);
        return result.data.id;
      }

      return null;
    } catch (error) {
      console.error("[Shave] Error checking for existing shave:", error);
      return null;
    }
  }, []);

  /**
   * Save a recording with video file metadata and shave information
   */
  const saveRecording = useCallback(
    async (shaveData: Omit<NewShave, "id">, recordingFile?: Omit<NewVideoFile, "id">) => {
      try {
        const result = await ipcClient.shave.create(shaveData, recordingFile);
        toast.success("Shave saved", {
          description: "The shave has been saved.",
        });
        return result;
      } catch (error) {
        console.error("[Shave] Failed to save recording:", error);
        toast.error("Failed to save shave", {
          description: "Video is processing, but it won't be saved in 'My Shaves'.",
        });
        return null;
      }
    },
    [],
  );

  /**
   * Listen for workflow completion and update shave
   */
  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;
      const { shaveId } = progressData;

      // Update shave status to Processing when upload/download starts
      if (
        (progressData.stage === "uploading_source" ||
          progressData.stage === "downloading_source") &&
        typeof shaveId === "number"
      ) {
        try {
          await ipcClient.shave.update(shaveId, {
            shaveStatus: ShaveStatus.Processing,
          });
        } catch (err) {
          console.error("[Shave] Error updating shave status to Processing (by id):", err);
        }
      }

      // Update shave when finished uploading video
      if (progressData.stage === "upload_completed" && typeof shaveId === "number") {
        const { uploadResult, sourceOrigin } = progressData;

        if (sourceOrigin === "external") {
          try {
            ipcClient.shave.attachVideoFile(shaveId, {
              fileName: uploadResult?.data?.title || "external-video",
              filePath: uploadResult?.data?.url || "",
              duration: uploadResult?.data?.duration || 0,
            });
          } catch (err) {
            console.error("[Shave] Error attaching external video file to shave:", err);
          }
        }

        try {
          await ipcClient.shave.update(shaveId, {
            videoEmbedUrl: uploadResult?.data?.url || null,
          });
        } catch (err) {
          console.error("[Shave] Error updating shave video URL (by id):", err);
        }

        return;
      }

      // Update shave when there's final output
      if (typeof progressData.finalOutput !== "undefined" && typeof shaveId === "number") {
        const { uploadResult, finalOutput } = progressData;

        try {
          const parsedOutput = parseFinalOutput(finalOutput);
          const finalTitle =
            parsedOutput.title || uploadResult?.data?.title || "Untitled Work Item";
          const shaveStatus = parsedOutput.status as ShaveStatus;

          await ipcClient.shave.update(shaveId, {
            title: finalTitle,
            shaveStatus,
            workItemUrl: parsedOutput.workItemUrl,
          });
        } catch (error) {
          console.error("\n[Shave] ✗ Failed to save/update shave record:");
          console.error("[Shave] Error:", error);
          console.error("=== SHAVE SAVE END (FAILED) ===\n");
          toast.error("Failed to save shave record");
        }
      }
    });
  }, []);

  return {
    saveRecording,
    checkExistingShave,
  };
}
